package dev.rabauer.depgraph.collect;

import org.apache.maven.model.Dependency;
import org.apache.maven.model.DependencyManagement;
import org.apache.maven.project.MavenProject;

public interface ManagedSourceLookup {

    /** Model id of the POM that manages the given artifact, or null if unknown. */
    String sourceOf(String groupId, String artifactId);

    static ManagedSourceLookup fromProject(MavenProject p) {
        return (g, a) -> {
            DependencyManagement dm = p.getDependencyManagement();
            if (dm == null) {
                return null;
            }
            for (Dependency d : dm.getDependencies()) {
                if (g.equals(d.getGroupId()) && a.equals(d.getArtifactId())) {
                    var location = d.getLocation("version");
                    if (location == null || location.getSource() == null) {
                        return null;
                    }
                    return location.getSource().getModelId();
                }
            }
            return null;
        };
    }
}
