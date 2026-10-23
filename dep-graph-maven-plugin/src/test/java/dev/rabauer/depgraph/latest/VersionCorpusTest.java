package dev.rabauer.depgraph.latest;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Rules that must hold for every real version string, not just hand-picked examples. */
class VersionCorpusTest {

    private static final List<String> TAGS = List.of("-RC1", "-SNAPSHOT", ".M2", "-beta-3", "-alpha");

    private static List<String> corpus() throws IOException {
        try (InputStream in = VersionCorpusTest.class.getResourceAsStream("maven-versions.txt")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).lines()
                    .filter(l -> !l.isBlank())
                    .toList();
        }
    }

    @Test
    void variantIsNeverNumericOrABareSeparator() throws IOException {
        List<String> violations = new ArrayList<>();
        for (String v : corpus()) {
            String variant = VersionClassifier.variant(v);
            if (!variant.isEmpty() && (Character.isDigit(variant.charAt(0)) || !variant.matches(".*[a-z].*"))) {
                violations.add(v + " -> '" + variant + "'");
            }
        }
        assertEquals(List.of(), violations);
    }

    @Test
    void preReleaseTagKeepsTheVariant() throws IOException {
        List<String> violations = new ArrayList<>();
        for (String v : corpus()) {
            if (!VersionClassifier.isStable(v)) {
                continue;
            }
            String variant = VersionClassifier.variant(v);
            List<String> preReleases = new ArrayList<>();
            for (String tag : TAGS) {
                preReleases.add(v + tag);
            }
            String suffix = v.substring(v.length() - variant.length());
            if (!variant.isEmpty() && "._-".indexOf(suffix.charAt(0)) >= 0) {
                preReleases.add(v.substring(0, v.length() - suffix.length()) + "-RC1" + suffix);
            }
            for (String pre : preReleases) {
                if (!VersionClassifier.variant(pre).equals(variant)) {
                    violations.add(pre + " -> '" + VersionClassifier.variant(pre) + "', expected '" + variant + "'");
                }
            }
        }
        assertEquals(List.of(), violations);
    }

    @Test
    void stableVersionIsNeverStrippedAsPreRelease() throws IOException {
        List<String> violations = new ArrayList<>();
        for (String v : corpus()) {
            if (VersionClassifier.isStable(v) && VersionClassifier.isStable(v + "-RC1")) {
                violations.add(v + "-RC1 counted stable");
            }
        }
        assertEquals(List.of(), violations);
    }

    @Test
    void noVersionIsAnUpdateOfItself() throws IOException {
        List<String> violations = new ArrayList<>();
        for (String v : corpus()) {
            if (VersionClassifier.classify(v, List.of(v)).newerInSameMajor()) {
                violations.add(v);
            }
        }
        assertEquals(List.of(), violations);
    }

    @Test
    void preReleaseUserIsOfferedTheRelease() throws IOException {
        List<String> violations = new ArrayList<>();
        for (String v : corpus()) {
            if (VersionClassifier.isStable(v) && !VersionClassifier.classify(v + "-RC1", List.of(v)).newerInSameMajor()) {
                violations.add(v + "-RC1 not offered " + v);
            }
        }
        assertEquals(List.of(), violations);
    }
}
