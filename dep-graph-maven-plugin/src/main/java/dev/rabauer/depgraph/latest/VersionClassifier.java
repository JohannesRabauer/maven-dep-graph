package dev.rabauer.depgraph.latest;

import dev.rabauer.depgraph.model.GraphModel;
import org.eclipse.aether.util.version.GenericVersionScheme;
import org.eclipse.aether.version.InvalidVersionSpecificationException;
import org.eclipse.aether.version.Version;

import java.util.List;
import java.util.regex.Pattern;

public final class VersionClassifier {

    // An unstable token only counts at the start or right after a non-letter, so "1.0-sources" stays stable.
    private static final Pattern UNSTABLE =
            Pattern.compile("(?i)(^|[^a-z])(snapshot|alpha|beta|m\\d+|rc|cr|preview)");

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

    /** {@code stableAscending} may be null, which returns null ("not checked"). */
    public static GraphModel.Latest classify(String current, List<String> stableAscending) {
        if (stableAscending == null) {
            return null;
        }
        String overall = stableAscending.isEmpty() ? null : stableAscending.get(stableAscending.size() - 1);
        String currentMajor = major(current);
        String sameMajor = null;
        for (String v : stableAscending) {
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
