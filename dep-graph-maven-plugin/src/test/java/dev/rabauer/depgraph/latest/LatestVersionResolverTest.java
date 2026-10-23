package dev.rabauer.depgraph.latest;

import org.eclipse.aether.DefaultRepositorySystemSession;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.resolution.VersionRangeRequest;
import org.eclipse.aether.resolution.VersionRangeResolutionException;
import org.eclipse.aether.resolution.VersionRangeResult;
import org.eclipse.aether.util.version.GenericVersionScheme;
import org.eclipse.aether.version.Version;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class LatestVersionResolverTest {

    private final AtomicInteger calls = new AtomicInteger();
    private final Map<String, Throwable> failures = new HashMap<>();

    private RepositorySystem stub() {
        return (RepositorySystem) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[]{RepositorySystem.class}, (proxy, method, args) -> {
                    if (!method.getName().equals("resolveVersionRange")) {
                        throw new UnsupportedOperationException(method.getName());
                    }
                    calls.incrementAndGet();
                    VersionRangeRequest request = (VersionRangeRequest) args[1];
                    VersionRangeResult result = new VersionRangeResult(request);
                    if (request.getArtifact().getArtifactId().equals("bad")) {
                        throw new VersionRangeResolutionException(result);
                    }
                    if (request.getArtifact().getArtifactId().equals("missing")) {
                        return result;
                    }
                    GenericVersionScheme scheme = new GenericVersionScheme();
                    List<Version> versions = new ArrayList<>();
                    for (String v : List.of("1.0", "2.0-beta", "2.0", "3.0-SNAPSHOT")) {
                        versions.add(scheme.parseVersion(v));
                    }
                    result.setVersions(versions);
                    return result;
                });
    }

    @Test
    void offlineSkipsLookup() {
        DefaultRepositorySystemSession session = new DefaultRepositorySystemSession();
        session.setOffline(true);
        Map<String, List<String>> result = new LatestVersionResolver(stub(), session, List.of(), 2, failures::put)
                .resolve(Set.of("g:a", "g:b"));
        assertEquals(2, result.size());
        assertNull(result.get("g:a"));
        assertNull(result.get("g:b"));
        assertEquals(0, calls.get());
        assertTrue(failures.isEmpty());
    }

    @Test
    void failedLookupReportsCause() {
        Map<String, List<String>> result = new LatestVersionResolver(
                stub(), new DefaultRepositorySystemSession(), List.of(), 2, failures::put)
                .resolve(Set.of("g:good", "g:bad"));
        assertEquals(2, result.size());
        assertEquals(List.of("1.0", "2.0"), result.get("g:good"));
        assertNull(result.get("g:bad"));
        assertEquals(Set.of("g:bad"), failures.keySet());
        assertInstanceOf(VersionRangeResolutionException.class, failures.get("g:bad"));
    }

    @Test
    void emptyResultIsNotAFailure() {
        Map<String, List<String>> result = new LatestVersionResolver(
                stub(), new DefaultRepositorySystemSession(), List.of(), 2, failures::put)
                .resolve(Set.of("g:missing"));
        assertEquals(List.of(), result.get("g:missing"));
        assertTrue(failures.isEmpty());
    }
}
