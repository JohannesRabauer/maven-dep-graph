package dev.rabauer.depgraph;

import dev.rabauer.depgraph.collect.DependencyGraphMapper;
import dev.rabauer.depgraph.collect.ManagedSourceLookup;
import dev.rabauer.depgraph.collect.ModuleGraphCollector;
import dev.rabauer.depgraph.latest.LatestVersionResolver;
import dev.rabauer.depgraph.latest.VersionClassifier;
import dev.rabauer.depgraph.model.GraphModel;
import dev.rabauer.depgraph.page.HtmlPageWriter;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.apache.maven.execution.MavenSession;
import org.apache.maven.plugin.AbstractMojo;
import org.apache.maven.plugin.MojoExecutionException;
import org.apache.maven.plugins.annotations.Component;
import org.apache.maven.plugins.annotations.LifecyclePhase;
import org.apache.maven.plugins.annotations.Mojo;
import org.apache.maven.plugins.annotations.Parameter;
import org.apache.maven.project.MavenProject;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.collection.DependencyCollectionException;

/** Writes one interactive HTML page of the whole reactor, once per build. */
@Mojo(name = "graph", defaultPhase = LifecyclePhase.PACKAGE, threadSafe = true)
public class DepGraphMojo extends AbstractMojo
{
    private static final int LATEST_LOOKUP_THREADS = 8;

    @Parameter(defaultValue = "${project}", readonly = true, required = true)
    private MavenProject project;

    @Parameter(defaultValue = "${session}", readonly = true)
    private MavenSession session;

    @Component
    private RepositorySystem repositorySystem;

    @Parameter(property = "depgraph.outputFile", defaultValue = "${project.build.directory}/dep-graph.html")
    private File outputFile;

    @Parameter(property = "depgraph.checkLatest", defaultValue = "true")
    private boolean checkLatest;

    @Override
    public void execute() throws MojoExecutionException
    {
        final List<MavenProject> projects = this.session.getProjects();
        final MavenProject writer = writerProject(this.session);
        if(this.project != writer)
        {
            // Exactly one info line per build, from the first project that is not the writer.
            if(projects.indexOf(this.project) == (projects.get(0) == writer ? 1 : 0))
            {
                this.getLog().info("Dependency graph is written once, from " + writer.getArtifactId()
                    + "; skipping the other " + (projects.size() - 1) + " reactor project(s)");
            }
            return;
        }

        final List<GraphModel.Module> modules = new ArrayList<>(projects.size());
        final Set<String> reactorNodeIds = new LinkedHashSet<>();
        for(final MavenProject p : projects)
        {
            final String id = nodeIdOf(p);
            modules.add(new GraphModel.Module(id, p.getArtifactId()));
            reactorNodeIds.add(id);
        }

        final DependencyGraphMapper mapper = new DependencyGraphMapper(reactorNodeIds);
        final ModuleGraphCollector collector =
            new ModuleGraphCollector(this.repositorySystem, this.session.getRepositorySession());
        for(final MavenProject p : projects)
        {
            try
            {
                mapper.addModuleGraph(nodeIdOf(p), collector.collect(p), ManagedSourceLookup.fromProject(p));
            }
            catch(final DependencyCollectionException e)
            {
                throw new MojoExecutionException("Could not collect dependencies of " + p.getArtifactId(), e);
            }
        }

        final List<GraphModel.Node> nodes = this.withLatest(mapper.nodes());
        final GraphModel model = new GraphModel(writer.getArtifactId(), modules, nodes, mapper.edges());

        final Path target = this.targetPath(writer);
        try
        {
            Files.createDirectories(target.getParent());
            Files.writeString(target, HtmlPageWriter.render(model), StandardCharsets.UTF_8);
        }
        catch(final IOException e)
        {
            throw new MojoExecutionException("Could not write " + target, e);
        }

        this.getLog().info("Dependency graph written to " + target
            + " (" + modules.size() + " modules, " + nodes.size() + " artifacts)");
    }

    /**
     * The one project that writes the page. With {@code -pl} or {@code -rf} the project Maven was
     * started in is not part of the reactor, so the last project to build takes over - by then every
     * module in the reactor has been collected.
     */
    private static MavenProject writerProject(final MavenSession session)
    {
        final List<MavenProject> projects = session.getProjects();
        final Path executionRoot = executionRoot(session);
        for(final MavenProject p : projects)
        {
            if(isExecutionRoot(p, executionRoot))
            {
                return p;
            }
        }
        return projects.get(projects.size() - 1);
    }

    /**
     * Keeps the page where the build was started: the writer's own {@code target} when it sits in
     * the directory Maven was started in, that directory's {@code target} otherwise.
     */
    private Path targetPath(final MavenProject writer)
    {
        final Path configured = this.outputFile.toPath();
        final Path byDefault = Path.of(writer.getBuild().getDirectory(), "dep-graph.html");
        final Path executionRoot = executionRoot(this.session);
        if(!configured.equals(byDefault) || isExecutionRoot(writer, executionRoot))
        {
            return configured;
        }
        return executionRoot.resolve("target").resolve("dep-graph.html");
    }

    private static Path executionRoot(final MavenSession session)
    {
        return Path.of(session.getExecutionRootDirectory()).toAbsolutePath().normalize();
    }

    private static boolean isExecutionRoot(final MavenProject p, final Path executionRoot)
    {
        final File basedir = p.getBasedir();
        return basedir != null && basedir.toPath().toAbsolutePath().normalize().equals(executionRoot);
    }

    private List<GraphModel.Node> withLatest(final Map<String, GraphModel.Node> collected)
    {
        if(!this.checkLatest)
        {
            return List.copyOf(collected.values());
        }

        final Set<String> groupArtifacts = new LinkedHashSet<>();
        for(final GraphModel.Node node : collected.values())
        {
            if(!node.module())
            {
                groupArtifacts.add(groupArtifactOf(node));
            }
        }

        final Map<String, List<String>> latest = new LatestVersionResolver(
            this.repositorySystem,
            this.session.getRepositorySession(),
            this.project.getRemoteProjectRepositories(),
            LATEST_LOOKUP_THREADS,
            (ga, cause) -> {}).resolve(groupArtifacts);

        final List<GraphModel.Node> nodes = new ArrayList<>(collected.size());
        for(final GraphModel.Node node : collected.values())
        {
            if(node.module())
            {
                nodes.add(node);
                continue;
            }
            final List<String> stable = latest.get(groupArtifactOf(node));
            nodes.add(new GraphModel.Node(node.id(), node.groupId(), node.artifactId(), node.version(),
                node.type(), node.classifier(), node.module(),
                VersionClassifier.classify(node.version(), stable)));
        }
        return nodes;
    }

    private static String groupArtifactOf(final GraphModel.Node node)
    {
        return node.groupId() + ":" + node.artifactId();
    }

    private static String nodeIdOf(final MavenProject p)
    {
        return GraphModel.nodeId(p.getGroupId(), p.getArtifactId(), "jar", "", p.getVersion());
    }
}
