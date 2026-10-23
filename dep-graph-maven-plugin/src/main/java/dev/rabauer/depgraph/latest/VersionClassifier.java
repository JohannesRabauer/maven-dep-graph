package dev.rabauer.depgraph.latest;

import dev.rabauer.depgraph.model.GraphModel;
import org.eclipse.aether.util.version.GenericVersionScheme;
import org.eclipse.aether.version.InvalidVersionSpecificationException;
import org.eclipse.aether.version.Version;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public final class VersionClassifier {

    // An unstable token only counts at the start or right after a non-letter, so "1.0-sources" stays stable.
    private static final String UNSTABLE_TOKENS =
            "snapshot|alpha|beta|m\\d+|rc|cr|preview|ea|dev|pre|b\\d+|milestone|nightly|canary";
    private static final Pattern UNSTABLE = Pattern.compile("(?i)(^|[^a-z])(" + UNSTABLE_TOKENS + ")");
    // The pre-release tag with its separator and counter, wherever it sits: "-RC1" in "33.0.0-RC1-jre".
    private static final Pattern PRE_RELEASE =
            Pattern.compile("(?i)[._-]?(?<![a-z])(" + UNSTABLE_TOKENS + ")([._-]?\\d+)?(?![a-z])");
    private static final Pattern NUMERIC_PREFIX = Pattern.compile("^v?\\d+(\\.\\d+)*");
    private static final Pattern NO_VARIANT = Pattern.compile("[.-](final|release|ga)|[.-]v?\\d+");

    private VersionClassifier() {
    }

    public static boolean isStable(String v) {
        return !UNSTABLE.matcher(v).find();
    }

    /** Leading digits of the version, "" if none. */
    public static String major(String v) {
        int i = 0;
        while (i < v.length() && Character.isDigit(v.charAt(i))) {
            i++;
        }
        return v.substring(0, i);
    }

    /** Suffix family of a version; candidates of another variant are never offered as an update. */
    public static String variant(String v) {
        // A pre-release keeps its platform suffix: "33.0.0-jre-SNAPSHOT" belongs to "-jre".
        String release = PRE_RELEASE.matcher(v).replaceAll("");
        String rest = NUMERIC_PREFIX.matcher(release).replaceFirst("").toLowerCase(Locale.ROOT);
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
