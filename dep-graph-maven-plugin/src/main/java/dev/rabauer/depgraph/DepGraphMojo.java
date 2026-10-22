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

/** Writes one interactive HTML page of the whole reactor, from the execution root. */
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
        if(!this.project.isExecutionRoot())
        {
            this.getLog().debug(
                "Skipping " + this.project.getArtifactId() + ", only the execution root writes the page");
            return;
        }

        final List<MavenProject> projects = this.session.getProjects();
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
        final GraphModel model = new GraphModel(this.project.getArtifactId(), modules, nodes, mapper.edges());

        final Path target = this.outputFile.toPath();
        try
        {
            Files.createDirectories(target.getParent());
            Files.writeString(target, HtmlPageWriter.render(model), StandardCharsets.UTF_8);
        }
        catch(final IOException e)
        {
            throw new MojoExecutionException("Could not write " + this.outputFile, e);
        }

        this.getLog().info("Dependency graph written to " + this.outputFile
            + " (" + modules.size() + " modules, " + nodes.size() + " artifacts)");
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
            LATEST_LOOKUP_THREADS).resolve(groupArtifacts);

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
