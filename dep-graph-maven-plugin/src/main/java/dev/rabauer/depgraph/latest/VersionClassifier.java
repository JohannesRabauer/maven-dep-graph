package dev.rabauer.depgraph.latest;

import dev.rabauer.depgraph.model.GraphModel;
import org.eclipse.aether.util.version.GenericVersionScheme;
import org.eclipse.aether.version.InvalidVersionSpecificationException;
import org.eclipse.aether.version.Version;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public final class VersionClassifier {

    // An unstable token only counts as a whole word, so "1.0-sources" and "1.0.1-premium" stay stable.
    private static final String UNSTABLE_TOKENS =
            "snapshot|alpha|beta|m\\d+|rc|cr|preview|ea|dev|pre|b\\d+|milestone|nightly|canary";
    private static final Pattern UNSTABLE = Pattern.compile("(?i)(^|[^a-z])(" + UNSTABLE_TOKENS + ")(?![a-z])");
    // The pre-release tag with its separator and counter, wherever it sits: "-RC1" in "33.0.0-RC1-jre".
    private static final Pattern PRE_RELEASE =
            Pattern.compile("(?i)[._-]?(?<![a-z])(" + UNSTABLE_TOKENS + ")([._+-]?\\d+)?(?![a-z])");
    private static final Pattern NUMERIC_PREFIX = Pattern.compile("^v?\\d+(\\.\\d+)*");
    // Counters that change with every release: "rev20240906" and "build217" are one variant, "-1.5.13" none.
    private static final Pattern COUNTER = Pattern.compile("(rev|build)\\d+");
    private static final Pattern TRAILING_NUMBERS = Pattern.compile("([.+-]v?\\d+)+$");
    private static final Pattern NO_VARIANT = Pattern.compile("[.-](final|release|ga)");

    private VersionClassifier() {
    }

    public static boolean isStable(String v) {
        return !UNSTABLE.matcher(v).find();
    }

    /** Leading digits of the version after an optional "v", "" if none. */
    public static String major(String v) {
        int start = v.startsWith("v") || v.startsWith("V") ? 1 : 0;
        int i = start;
        while (i < v.length() && Character.isDigit(v.charAt(i))) {
            i++;
        }
        return v.substring(start, i);
    }

    /** Suffix family of a version; candidates of another variant are never offered as an update. */
    public static String variant(String v) {
        // A pre-release keeps its platform suffix: "33.0.0-jre-SNAPSHOT" belongs to "-jre".
        String release = PRE_RELEASE.matcher(v).replaceAll("");
        String rest = NUMERIC_PREFIX.matcher(release).replaceFirst("").toLowerCase(Locale.ROOT);
        rest = TRAILING_NUMBERS.matcher(COUNTER.matcher(rest).replaceAll("$1")).replaceFirst("");
        return NO_VARIANT.matcher(rest).matches() ? "" : rest;
    }

    /** {@code stableAscending} may be null, which returns null ("not checked"). */
    public static GraphModel.Latest classify(String current, List<String> stableAscending) {
        if (stableAscending == null) {
            return null;
        }
        String currentVariant = variant(current);
        String currentMajor = major(current);
        String overall = null;
        String sameMajor = null;
        for (String v : stableAscending) {
            if (!variant(v).equals(currentVariant)) {
                continue;
            }
            overall = v;
            if (major(v).equals(currentMajor)) {
                sameMajor = v;
            }
        }
        boolean newer = sameMajor != null && parse(sameMajor).compareTo(parse(current)) > 0;
        return new GraphModel.Latest(sameMajor, overall, newer);
    }

    private static Version parse(String v) {
        try {
            return new GenericVersionScheme().parseVersion(v);
        } catch (InvalidVersionSpecificationException e) {
            throw new IllegalArgumentException(e);
        }
    }
}
