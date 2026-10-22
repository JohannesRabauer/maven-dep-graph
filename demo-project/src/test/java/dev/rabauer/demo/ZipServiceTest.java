package dev.rabauer.demo;

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
import org.springframework.mock.web.MockMultipartFile;

class ZipServiceTest
{
    @Test
    void zipsAllFilesAndRenamesDuplicates() throws IOException
    {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();

        new ZipService().zip(List.of(
            file("notes.txt", "a"),
            file("notes.txt", "b"),
            file("../../evil/README", "c")), out);

        final List<String> names = new ArrayList<>();
        try(final ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(out.toByteArray())))
        {
            for(ZipEntry entry; (entry = zip.getNextEntry()) != null; )
            {
                names.add(entry.getName());
            }
        }
        assertThat(names).containsExactly("notes.txt", "notes (2).txt", "README");
    }

    private static MockMultipartFile file(final String name, final String content)
    {
        return new MockMultipartFile("files", name, "text/plain", content.getBytes(StandardCharsets.UTF_8));
    }
}
