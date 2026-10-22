package dev.rabauer.depgraph.collect;

import org.apache.maven.RepositoryUtils;
import org.apache.maven.model.DependencyManagement;
import org.apache.maven.project.MavenProject;
import org.eclipse.aether.DefaultRepositorySystemSession;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.RepositorySystemSession;
import org.eclipse.aether.collection.CollectRequest;
import org.eclipse.aether.collection.DependencyCollectionException;
import org.eclipse.aether.graph.Dependency;
import org.eclipse.aether.graph.DependencyNode;
import org.eclipse.aether.util.graph.manager.DependencyManagerUtils;
import org.eclipse.aether.util.graph.transformer.ConflictResolver;

import java.util.ArrayList;
import java.util.List;

/** Collects a module's declared dependencies verbosely, so losers and managed versions stay visible. */
public final class ModuleGraphCollector {

    private final RepositorySystem system;
    private final RepositorySystemSession session;

    public ModuleGraphCollector(RepositorySystem system, RepositorySystemSession baseSession) {
        this.system = system;
        DefaultRepositorySystemSession verbose = new DefaultRepositorySystemSession(baseSession);
        verbose.setConfigProperty(ConflictResolver.CONFIG_PROP_VERBOSE, ConflictResolver.Verbosity.STANDARD);
        verbose.setConfigProperty(DependencyManagerUtils.CONFIG_PROP_VERBOSE, true);
        this.session = verbose;
    }

    /** Verbose collection of p's declared dependencies (all scopes) with p's dependencyManagement. */
    public DependencyNode collect(MavenProject p) throws DependencyCollectionException {
        CollectRequest request = new CollectRequest();
        request.setRootArtifact(RepositoryUtils.toArtifact(p.getArtifact()));
        request.setDependencies(toDependencies(p.getDependencies()));
        DependencyManagement dm = p.getDependencyManagement();
        if (dm != null) {
            request.setManagedDependencies(toDependencies(dm.getDependencies()));
        }
        request.setRepositories(p.getRemoteProjectRepositories());
        return system.collectDependencies(session, request).getRoot();
    }

    private List<Dependency> toDependencies(List<org.apache.maven.model.Dependency> declared) {
        List<Dependency> result = new ArrayList<>(declared.size());
        for (org.apache.maven.model.Dependency d : declared) {
            result.add(RepositoryUtils.toDependency(d, session.getArtifactTypeRegistry()));
        }
        return result;
    }
}
