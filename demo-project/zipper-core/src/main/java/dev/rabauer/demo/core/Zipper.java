package dev.rabauer.demo.core;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.Deflater;

import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.apache.tika.Tika;

/** Writes files into one zip archive. */
public final class Zipper
{
    /** Opens the content of one file. */
    @FunctionalInterface
    public interface Content
    {
        InputStream open() throws IOException;
    }

    /** One file to add: its name as sent by the client and a way to read it. */
    public record Entry(String name, Content content)
    {
    }

    private static final Tika TIKA = new Tika();
    private static final Set<String> COMPRESSED_TYPES = Set.of(
        "application/zip", "application/gzip", "application/x-7z-compressed", "application/x-rar-compressed",
        "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp");

    /**
     * Writes all entries into one zip archive. Duplicate names get a counter, e.g. {@code notes (2).txt}.
     * Files that are already compressed (images, archives, media) are stored without recompressing them.
     */
    public void zip(final List<Entry> entries, final OutputStream target) throws IOException
    {
        final Set<String> usedNames = new HashSet<>();
        try(final ZipArchiveOutputStream zip = new ZipArchiveOutputStream(target))
        {
            for(final Entry entry : entries)
            {
                final String name = uniqueName(baseName(entry.name()), usedNames);
                zip.setLevel(isCompressed(name) ? Deflater.NO_COMPRESSION : Deflater.DEFAULT_COMPRESSION);
                zip.putArchiveEntry(new ZipArchiveEntry(name));
                try(final InputStream in = entry.content().open())
                {
                    in.transferTo(zip);
                }
                zip.closeArchiveEntry();
            }
        }
    }

    static boolean isCompressed(final String name)
    {
        final String type = TIKA.detect(name);
        return COMPRESSED_TYPES.contains(type) || type.startsWith("video/") || type.startsWith("audio/");
    }

    private static String baseName(final String name)
    {
        // Clients may send a path; keep only the file name so entries can't escape the archive root
        final String normalized = name == null ? "" : name.replace('\\', '/');
        final String base = normalized.substring(normalized.lastIndexOf('/') + 1).strip();
        return base.isEmpty() || base.equals("..") ? "file" : base;
    }

    private static String uniqueName(final String name, final Set<String> usedNames)
    {
        final int dot = name.lastIndexOf('.');
        final String stem = dot > 0 ? name.substring(0, dot) : name;
        final String extension = dot > 0 ? name.substring(dot) : "";
        String candidate = name;
        for(int i = 2; !usedNames.add(candidate); i++)
        {
            candidate = stem + " (" + i + ")" + extension;
        }
        return candidate;
    }
}
