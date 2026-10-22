package dev.rabauer.depgraph.latest;

import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.RepositorySystemSession;
import org.eclipse.aether.artifact.DefaultArtifact;
import org.eclipse.aether.repository.RemoteRepository;
import org.eclipse.aether.resolution.VersionRangeRequest;
import org.eclipse.aether.resolution.VersionRangeResult;
import org.eclipse.aether.version.Version;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public final class LatestVersionResolver {

    private final RepositorySystem system;
    private final RepositorySystemSession session;
    private final List<RemoteRepository> repos;
    private final int threads;

    public LatestVersionResolver(RepositorySystem system, RepositorySystemSession session,
                                 List<RemoteRepository> repos, int threads) {
        this.system = system;
        this.session = session;
        this.repos = repos;
        this.threads = Math.max(1, threads);
    }

    /** Key "g:a" maps to stable versions ascending; a null value means "not checked". */
    public Map<String, List<String>> resolve(Set<String> groupArtifacts) {
        Map<String, List<String>> result = new HashMap<>();
        if (session.isOffline() || groupArtifacts.isEmpty()) {
            for (String ga : groupArtifacts) {
                result.put(ga, null);
            }
            return result;
        }
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        try {
            Map<String, Future<List<String>>> futures = new HashMap<>();
            for (String ga : groupArtifacts) {
                futures.put(ga, executor.submit(() -> lookup(ga)));
            }
            for (Map.Entry<String, Future<List<String>>> e : futures.entrySet()) {
                List<String> versions;
                try {
                    versions = e.getValue().get();
                } catch (InterruptedException ex) {
                    Thread.currentThread().interrupt();
                    versions = null;
                } catch (Exception ex) {
                    versions = null;
                }
                result.put(e.getKey(), versions);
            }
        } finally {
            executor.shutdownNow();
        }
        return result;
    }

    private List<String> lookup(String ga) throws Exception {
        int colon = ga.indexOf(':');
        String g = ga.substring(0, colon);
        String a = ga.substring(colon + 1);
        VersionRangeRequest request = new VersionRangeRequest(new DefaultArtifact(g, a, "jar", "[0,)"), repos, null);
        VersionRangeResult range = system.resolveVersionRange(session, request);
        return range.getVersions().stream()
                .map(Version::toString)
                .filter(VersionClassifier::isStable)
                .toList();
    }
}
