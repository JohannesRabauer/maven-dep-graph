package dev.rabauer.demo.core;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.junit.jupiter.api.Test;

class ZipperTest
{
    @Test
    void zipsAllFilesAndRenamesDuplicates() throws IOException
    {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();

        new Zipper().zip(List.of(
            entry("notes.txt", "a"),
            entry("notes.txt", "b"),
            entry("../../evil/README", "c"),
            entry("C:\\Users\\me\\photo.jpg", "d")), out);

        final List<String> names = new ArrayList<>();
        try(final ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(out.toByteArray())))
        {
            for(ZipEntry e; (e = zip.getNextEntry()) != null; )
            {
                names.add(e.getName());
            }
        }
        assertThat(names).containsExactly("notes.txt", "notes (2).txt", "README", "photo.jpg");
    }

    @Test
    void recognisesAlreadyCompressedFiles()
    {
        assertThat(Zipper.isCompressed("holiday.jpg")).isTrue();
        assertThat(Zipper.isCompressed("backup.zip")).isTrue();
        assertThat(Zipper.isCompressed("notes.txt")).isFalse();
    }

    private static Zipper.Entry entry(final String name, final String content)
    {
        return new Zipper.Entry(name, () -> new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8)));
    }
}
