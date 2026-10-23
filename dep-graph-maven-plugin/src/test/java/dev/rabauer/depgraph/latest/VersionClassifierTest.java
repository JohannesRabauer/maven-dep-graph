package dev.rabauer.depgraph.latest;

import dev.rabauer.depgraph.model.GraphModel.Latest;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VersionClassifierTest {

    private static final List<String> VERSIONS = List.of("2.17.0", "2.19.2", "2.20.1", "3.0.2");

    @Test
    void isStable() {
        for (String v : List.of("2.0.0-SNAPSHOT", "1.0.0-alpha1", "3.0.0-M2", "3.0.0-RC1",
                "5.0.0.CR1", "1.0.0-preview", "2.0-beta", "21-ea", "1.0.dev3", "2.0-b01", "1.0-pre1",
                "1.0.Beta1", "8.0-milestone-1", "1.0-nightly", "1.0-canary", "22-ea+11", "2.9.0.pr1")) {
            assertFalse(VersionClassifier.isStable(v), v);
        }
        for (String v : List.of("2.19.2", "1.2.3.Final", "1.0-sources", "33.0.0-jre", "33.0.0-android",
                "1.5.0-jdk11", "1.0.1-premium", "1.0.1-device", "1.2-easymock", "1.0-presto")) {
            assertTrue(VersionClassifier.isStable(v), v);
        }
    }

    @Test
    void majorIsLeadingDigits() {
        assertEquals("2", VersionClassifier.major("2.19.2"));
        assertEquals("", VersionClassifier.major("x1"));
    }

    @Test
    void majorSkipsVPrefix() {
        assertEquals("1", VersionClassifier.major("v1.2"));
        assertEquals("1", VersionClassifier.major("V1.2"));
    }

    @Test
    void classifyVPrefixedNewMajorIsNotSameMajor() {
        assertEquals(new Latest("v1.2", "v2.0", false), VersionClassifier.classify("v1.2", List.of("v1.2", "v2.0")));
    }

    @Test
    void classifyPicksSameMajorAndOverall() {
        assertEquals(new Latest("2.20.1", "3.0.2", true), VersionClassifier.classify("2.19.2", VERSIONS));
    }

    @Test
    void classifyUpToDate() {
        assertEquals(new Latest("3.0.2", "3.0.2", false), VersionClassifier.classify("3.0.2", VERSIONS));
    }

    @Test
    void variantIsTheSuffixAfterTheNumbers() {
        assertEquals("-jre", VersionClassifier.variant("33.0.0-jre"));
        assertEquals("-android", VersionClassifier.variant("33.3.1-android"));
        assertEquals("-jdk11", VersionClassifier.variant("1.5.0-jdk11"));
        assertEquals("", VersionClassifier.variant("2.19.2"));
        assertEquals("", VersionClassifier.variant("20040616"));
    }

    @Test
    void variantNormalisesReleaseMarkers() {
        assertEquals("", VersionClassifier.variant("6.4.4.Final"));
        assertEquals("", VersionClassifier.variant("5.2.9.RELEASE"));
        assertEquals("", VersionClassifier.variant("1.0.GA"));
        assertEquals("", VersionClassifier.variant("1.2.3-1"));
        assertEquals("", VersionClassifier.variant("3.0.0-RC1"));
    }

    @Test
    void classifyStaysInVariant() {
        List<String> guava = List.of("33.0.0-android", "33.0.0-jre", "33.0.1-android", "34.0.0-android");
        assertEquals(new Latest("33.0.0-jre", "33.0.0-jre", false), VersionClassifier.classify("33.0.0-jre", guava));
    }

    @Test
    void classifyCrossesReleaseMarker() {
        assertEquals(new Latest("5.3.39", "5.3.39", true),
                VersionClassifier.classify("5.2.9.RELEASE", List.of("5.2.9.RELEASE", "5.3.39")));
        assertEquals(new Latest("6.6.1.Final", "7.0.0.Final", true),
                VersionClassifier.classify("6.4.4.Final", List.of("6.4.4.Final", "6.6.1.Final", "7.0.0.Final")));
    }

    @Test
    void classifyUnstableCurrentUsesPlainVariant() {
        assertEquals(new Latest("3.0.2", "3.0.2", true), VersionClassifier.classify("3.0.0-RC1", VERSIONS));
    }

    @Test
    void classifyKeepsVPrefixedAndDatedVersionsInOneVariant() {
        assertEquals(new Latest("v1.3", "v1.3", true), VersionClassifier.classify("v1.2", List.of("v1.2", "v1.3")));
        assertEquals(new Latest("1.0.1.v20220101", "1.0.1.v20220101", true),
                VersionClassifier.classify("1.0.0.v20210101", List.of("1.0.0.v20210101", "1.0.1.v20220101")));
    }

    @Test
    void variantOfPreReleaseKeepsPlatformSuffix() {
        assertEquals("-jre", VersionClassifier.variant("33.0.0-jre-SNAPSHOT"));
        assertEquals("-android", VersionClassifier.variant("33.0.0-android-rc1"));
        assertEquals("", VersionClassifier.variant("3.0.0.CR1"));
        assertEquals("-jre", VersionClassifier.variant("33.0.0-RC1-jre"));
        assertEquals("", VersionClassifier.variant("3.0.0RC1"));
        assertEquals("", VersionClassifier.variant("8.0-milestone-1"));
    }

    @Test
    void classifyPreReleaseWithoutSeparatorSeesRelease() {
        assertEquals(new Latest("3.0.2", "3.0.2", true), VersionClassifier.classify("3.0.0RC1", List.of("3.0.2")));
    }

    @Test
    void classifyPreReleaseBeforePlatformSuffixStaysInVariant() {
        assertEquals(new Latest("33.0.1-jre", "33.0.1-jre", true),
                VersionClassifier.classify("33.0.0-RC1-jre", List.of("33.0.1", "33.0.1-jre")));
    }

    @Test
    void classifyPreReleaseWithPlatformSuffixStaysInVariant() {
        assertEquals(new Latest("33.0.1-jre", "33.0.1-jre", true),
                VersionClassifier.classify("33.0.0-jre-SNAPSHOT", List.of("33.0.1", "33.0.1-jre")));
    }

    @Test
    void classifyKeepsByteBuddyJdk5LineApart() {
        // Byte Buddy publishes every release since 1.18.6 twice: plain and -jdk5 (ascending, as Aether sorts them).
        List<String> byteBuddy = List.of("1.18.6", "1.18.6-jdk5", "1.18.6-jdk6-jdk5", "1.18.15", "1.18.15-jdk5");
        assertEquals(new Latest("1.18.15", "1.18.15", true), VersionClassifier.classify("1.18.6", byteBuddy));
        assertEquals(new Latest("1.18.15-jdk5", "1.18.15-jdk5", true),
                VersionClassifier.classify("1.18.6-jdk5", byteBuddy));
        assertEquals(new Latest("1.18.15", "1.18.15", false), VersionClassifier.classify("1.18.15", byteBuddy));
    }

    @Test
    void variantIgnoresRevisionAndBuildCounters() {
        assertEquals(VersionClassifier.variant("v3-rev20240906-2.0.0"), VersionClassifier.variant("v3-rev20260925-2.0.0"));
        assertEquals(VersionClassifier.variant("1.0.0-build217"), VersionClassifier.variant("1.0.0-build222"));
        assertEquals("-jre", VersionClassifier.variant("1.2.3-jre-1"));
        assertEquals("-jdk11", VersionClassifier.variant("1.5.0-jdk11"));
        assertEquals("", VersionClassifier.variant("22-ea+11"));
    }

    @Test
    void variantKeepsNumberAfterPlatformWord() {
        assertEquals("-jdk-11", VersionClassifier.variant("1.0-jdk-11"));
        assertNotEquals(VersionClassifier.variant("1.0-jdk-8"), VersionClassifier.variant("1.0-jdk-11"));
        assertEquals("-jdk-11", VersionClassifier.variant("1.0-jdk-11-2"));
    }

    @Test
    void classifyKeepsGroovyAndHBaseLinesApart() {
        assertEquals("-hbase-1.3", VersionClassifier.variant("4.14.3-HBase-1.3"));
        List<String> spock = List.of("2.3-groovy-3.0", "2.3-groovy-4.0", "2.5-groovy-3.0", "2.5-groovy-4.0", "2.5-groovy-6.0");
        assertEquals(new Latest("2.5-groovy-3.0", "2.5-groovy-3.0", true), VersionClassifier.classify("2.3-groovy-3.0", spock));
    }

    @Test
    void classifyCrossesRevisionCounter() {
        assertEquals(new Latest("v3-rev20260925-2.0.0", "v3-rev20260925-2.0.0", true),
                VersionClassifier.classify("v3-rev20240906-2.0.0", List.of("v3-rev20240906-2.0.0", "v3-rev20260925-2.0.0")));
        assertEquals(new Latest("22.0.1", "22.0.1", true), VersionClassifier.classify("22-ea+11", List.of("22.0.1")));
    }

    @Test
    void classifyKeepsDatedLegacyReleasesApart() {
        // commons-collections' stable history: date-stamped 2003/2004 builds sort above 3.2.2.
        List<String> collections = List.of("1.0", "2.0", "2.0.20020914.015953", "2.0.20020914.020746",
                "2.0.20020914.020858", "2.1", "2.1.1", "3.0", "3.1", "3.2", "3.2.1", "3.2.2",
                "20030418.083655", "20031027.000000", "20040102.233541", "20040616");
        assertEquals(new Latest("3.2.2", "3.2.2", true), VersionClassifier.classify("3.2.1", collections));
        assertEquals(new Latest("20040616", "20040616", true), VersionClassifier.classify("20030418.083655", collections));
    }

    @Test
    void classifyTreatsDatedVersionsAsOneLine() {
        // org.json:json is date-stamped only.
        assertEquals(new Latest("20250107", "20250107", true),
                VersionClassifier.classify("20231013", List.of("20230227", "20231013", "20250107")));
    }

    @Test
    void classifyReadsUnderscoreAsSeparator() {
        assertEquals("", VersionClassifier.variant("2.7.7_4"));
        assertEquals(new Latest("2.2.2", "3.3.0", true),
                VersionClassifier.classify("2.1_3", List.of("2.1", "2.1_3", "2.2", "2.2.2", "3.3.0")));
    }

    @Test
    void classifyOffersGraduatedReleaseToIncubatingUser() {
        assertEquals(new Latest("2.3.35", "2.3.35", true),
                VersionClassifier.classify("2.3.27-incubating", List.of("2.3.27-incubating", "2.3.35")));
    }

    @Test
    void classifyOffersSpringSecurityRelease() {
        assertEquals("", VersionClassifier.variant("2.5.6.SEC02"));
        assertEquals(new Latest("2.5.6.SEC03", "2.5.6.SEC03", true),
                VersionClassifier.classify("2.5.6", List.of("2.5.5", "2.5.6", "2.5.6.SEC01", "2.5.6.SEC03")));
    }

    @Test
    void classifyIgnoresPostgresBuildNumberBeforeJdbcLine() {
        assertEquals("-jdbc42", VersionClassifier.variant("9.4-1206-jdbc42"));
        assertEquals(new Latest("9.4-1206-jdbc41", "9.4-1206-jdbc41", true), VersionClassifier.classify("9.4-1200-jdbc41",
                List.of("9.4-1200-jdbc41", "9.4-1200-jdbc42", "9.4-1206-jdbc41", "9.4-1206-jdbc42")));
    }

    @Test
    void classifyNullIsNotChecked() {
        assertNull(VersionClassifier.classify("1.0", null));
    }
}
