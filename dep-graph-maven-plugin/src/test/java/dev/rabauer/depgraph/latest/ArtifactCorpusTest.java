package dev.rabauer.depgraph.latest;

import dev.rabauer.depgraph.model.GraphModel.Latest;
import org.eclipse.aether.util.version.GenericVersionScheme;
import org.eclipse.aether.version.InvalidVersionSpecificationException;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Rules that must hold over the full stable history of real artifacts (maven-metadata.xml from Maven Central). */
class ArtifactCorpusTest {

    private static final GenericVersionScheme SCHEME = new GenericVersionScheme();

    // "group:artifact variant" (or "group:artifact *") -> why a one-off variant is accepted.
    private static final Map<String, String> SINGLE_RELEASE_VARIANTS = Map.ofEntries(
            Map.entry("com.google.guava:guava r03", "pre-10.0 naming: each rNN is its own major, no update to miss"),
            Map.entry("com.google.guava:guava r05", "pre-10.0 naming: each rNN is its own major, no update to miss"),
            Map.entry("com.google.guava:guava r06", "pre-10.0 naming: each rNN is its own major, no update to miss"),
            Map.entry("com.google.guava:guava r07", "pre-10.0 naming: each rNN is its own major, no update to miss"),
            Map.entry("com.google.guava:guava r08", "pre-10.0 naming: each rNN is its own major, no update to miss"),
            Map.entry("com.google.guava:guava r09", "pre-10.0 naming: each rNN is its own major, no update to miss"),
            Map.entry("net.bytebuddy:byte-buddy -jdk6-jdk5", "1.18.6-jdk6-jdk5 is a publishing mistake"),
            Map.entry("ch.qos.logback:logback-classic -groovyless", "one-off 1.2.4 build without Groovy config"),
            Map.entry("com.google.protobuf:protobuf-java a", "2.4.0a re-release; its users miss 2.4.1+ (known limit)"),
            Map.entry("org.springframework.cloud:spring-cloud-dependencies *",
                    "release trains (Hoxton.SR12) have no numeric major; their users are never offered an update"));

    private static Map<String, List<String>> stableHistories() throws IOException {
        Map<String, List<String>> histories = new LinkedHashMap<>();
        try (InputStream in = ArtifactCorpusTest.class.getResourceAsStream("artifact-versions.txt")) {
            for (String line : new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().toList()) {
                String[] parts = line.split("\t");
                histories.put(parts[0], Arrays.stream(parts[1].split(" "))
                        .filter(VersionClassifier::isStable)
                        .sorted(Comparator.comparing(ArtifactCorpusTest::parse))
                        .toList());
            }
        }
        return histories;
    }

    @Test
    void everyVariantHasAtLeastTwoReleases() throws IOException {
        List<String> violations = new ArrayList<>();
        stableHistories().forEach((artifact, stable) -> {
            Map<String, List<String>> byVariant = new LinkedHashMap<>();
            for (String v : stable) {
                byVariant.computeIfAbsent(VersionClassifier.variant(v), k -> new ArrayList<>()).add(v);
            }
            byVariant.forEach((variant, versions) -> {
                if (versions.size() < 2 && !SINGLE_RELEASE_VARIANTS.containsKey(artifact + " " + variant)
                        && !SINGLE_RELEASE_VARIANTS.containsKey(artifact + " *")) {
                    violations.add(artifact + " '" + variant + "' only on " + versions);
                }
            });
        });
        assertEquals(List.of(), violations);
    }

    @Test
    void classifyStaysInMajorAndVariant() throws IOException {
        List<String> violations = new ArrayList<>();
        stableHistories().forEach((artifact, stable) -> {
            Map<String, String> newestOfVariant = new LinkedHashMap<>();
            for (String v : stable) {
                newestOfVariant.put(VersionClassifier.variant(v), v);
            }
            for (String v : stable) {
                Latest latest = VersionClassifier.classify(v, stable);
                String sameMajor = latest.latestSameMajor();
                if (sameMajor != null && !VersionClassifier.major(sameMajor).equals(VersionClassifier.major(v))) {
                    violations.add(artifact + " " + v + ": same major " + sameMajor);
                }
                if (latest.latestOverall() != null
                        && !VersionClassifier.variant(latest.latestOverall()).equals(VersionClassifier.variant(v))) {
                    violations.add(artifact + " " + v + ": overall " + latest.latestOverall());
                }
            }
            for (String newest : newestOfVariant.values()) {
                if (VersionClassifier.classify(newest, stable).newerInSameMajor()) {
                    violations.add(artifact + " " + newest + ": newest of its variant told to update");
                }
            }
        });
        assertEquals(List.of(), violations);
    }

    private static org.eclipse.aether.version.Version parse(String v) {
        try {
            return SCHEME.parseVersion(v);
        } catch (InvalidVersionSpecificationException e) {
            throw new IllegalArgumentException(e);
        }
    }
}
