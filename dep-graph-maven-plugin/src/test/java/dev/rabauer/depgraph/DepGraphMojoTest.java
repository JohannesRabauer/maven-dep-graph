package dev.rabauer.depgraph;

import dev.rabauer.depgraph.model.GraphModel;
import org.apache.maven.execution.DefaultMavenExecutionRequest;
import org.apache.maven.execution.DefaultMavenExecutionResult;
import org.apache.maven.execution.MavenSession;
import org.apache.maven.plugin.logging.SystemStreamLog;
import org.apache.maven.project.MavenProject;
import org.eclipse.aether.DefaultRepositorySystemSession;
import org.eclipse.aether.RepositorySystem;
import org.eclipse.aether.resolution.VersionRangeRequest;
import org.eclipse.aether.resolution.VersionRangeResolutionException;
import org.eclipse.aether.resolution.VersionRangeResult;
import org.eclipse.aether.util.version.GenericVersionScheme;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

class DepGraphMojoTest {

    private final DefaultRepositorySystemSession repoSession = new DefaultRepositorySystemSession();
    private final RecordingLog log = new RecordingLog();
    private final DepGraphMojo mojo = new DepGraphMojo();

    @BeforeEach
    void setUp() throws Exception {
        set("repositorySystem", stub());
        set("session", new MavenSession(null, repoSession, new DefaultMavenExecutionRequest(),
                new DefaultMavenExecutionResult()));
        set("project", new MavenProject());
        set("checkLatest", true);
        mojo.setLog(log);
    }

    @Test
    void warnsOnceWithCountWhenLookupsFail() {
        mojo.withLatest(nodes("good", "bad1", "bad2"));
        assertEquals(List.of("Latest version unknown for 2 artifact(s) (network/repository errors); run with -X for details"),
                log.warnings);
        assertEquals(Set.of("Latest version lookup failed for g:bad1", "Latest version lookup failed for g:bad2"),
                log.debugs.keySet());
        assertInstanceOf(VersionRangeResolutionException.class, log.debugs.get("Latest version lookup failed for g:bad1"));
    }

    @Test
    void noWarningWhenAllLookupsSucceed() {
        mojo.withLatest(nodes("good", "other"));
        assertEquals(List.of(), log.warnings);
    }

    @Test
    void noWarningOffline() {
        repoSession.setOffline(true);
        mojo.withLatest(nodes("bad1"));
        assertEquals(List.of(), log.warnings);
    }

    private void set(String name, Object value) throws Exception {
        Field field = DepGraphMojo.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(mojo, value);
    }

    private static Map<String, GraphModel.Node> nodes(String... artifactIds) {
        Map<String, GraphModel.Node> nodes = new LinkedHashMap<>();
        for (String a : artifactIds) {
            GraphModel.Node node = new GraphModel.Node("g:" + a + ":1.0", "g", a, "1.0", "jar", "", false, null);
            nodes.put(node.id(), node);
        }
        return nodes;
    }

    private RepositorySystem stub() {
        return (RepositorySystem) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[]{RepositorySystem.class}, (proxy, method, args) -> {
                    if (!method.getName().equals("resolveVersionRange")) {
                        throw new UnsupportedOperationException(method.getName());
                    }
                    VersionRangeRequest request = (VersionRangeRequest) args[1];
                    VersionRangeResult result = new VersionRangeResult(request);
                    if (request.getArtifact().getArtifactId().startsWith("bad")) {
                        throw new VersionRangeResolutionException(result);
                    }
                    GenericVersionScheme scheme = new GenericVersionScheme();
                    result.setVersions(new ArrayList<>(List.of(scheme.parseVersion("1.0"), scheme.parseVersion("2.0"))));
                    return result;
                });
    }

    private static final class RecordingLog extends SystemStreamLog {
        final List<String> warnings = new ArrayList<>();
        final Map<String, Throwable> debugs = new HashMap<>();

        @Override
        public void warn(CharSequence content) {
            warnings.add(content.toString());
        }

        @Override
        public void debug(CharSequence content, Throwable error) {
            debugs.put(content.toString(), error);
        }
    }
}
