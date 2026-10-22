package dev.rabauer.depgraph;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Collectors;

import org.apache.maven.artifact.Artifact;
import org.apache.maven.plugin.AbstractMojo;
import org.apache.maven.plugin.MojoExecutionException;
import org.apache.maven.plugins.annotations.LifecyclePhase;
import org.apache.maven.plugins.annotations.Mojo;
import org.apache.maven.plugins.annotations.Parameter;
import org.apache.maven.plugins.annotations.ResolutionScope;
import org.apache.maven.project.MavenProject;

/**
 * Writes an HTML page of the project's dependencies.
 * <p>
 * Placeholder for now: lists the resolved artifacts. The interactive graph is built from the spec.
 */
@Mojo(
    name = "graph",
    defaultPhase = LifecyclePhase.PACKAGE,
    requiresDependencyResolution = ResolutionScope.TEST,
    threadSafe = true)
public class DepGraphMojo extends AbstractMojo
{
    @Parameter(defaultValue = "${project}", readonly = true, required = true)
    private MavenProject project;

    @Parameter(property = "depgraph.outputFile", defaultValue = "${project.build.directory}/dep-graph.html")
    private File outputFile;

    @Override
    public void execute() throws MojoExecutionException
    {
        final String items = this.project.getArtifacts().stream()
            .map(DepGraphMojo::toListItem)
            .collect(Collectors.joining("\n"));

        final String html = """
            <!doctype html>
            <html lang="en">
            <head><meta charset="utf-8"><title>Dependency Graph: %s</title></head>
            <body>
            <h1>%s</h1>
            <ul>
            %s
            </ul>
            </body>
            </html>
            """.formatted(this.project.getArtifactId(), this.project.getId(), items);

        try
        {
            final Path target = this.outputFile.toPath();
            Files.createDirectories(target.getParent());
            Files.writeString(target, html, StandardCharsets.UTF_8);
        }
        catch(final IOException e)
        {
            throw new MojoExecutionException("Could not write " + this.outputFile, e);
        }
        this.getLog().info("Dependency graph written to " + this.outputFile);
    }

    private static String toListItem(final Artifact artifact)
    {
        return "<li>" + artifact.getId() + "</li>";
    }
}
