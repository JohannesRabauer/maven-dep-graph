package dev.rabauer.demo;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
public class ZipService
{
    /**
     * Writes all files into one zip archive. Duplicate names get a counter, e.g. {@code notes (2).txt}.
     */
    public void zip(final List<MultipartFile> files, final OutputStream target) throws IOException
    {
        final Set<String> usedNames = new HashSet<>();
        try(final ZipOutputStream zip = new ZipOutputStream(target))
        {
            for(final MultipartFile file : files)
            {
                zip.putNextEntry(new ZipEntry(uniqueName(entryName(file), usedNames)));
                try(final InputStream in = file.getInputStream())
                {
                    in.transferTo(zip);
                }
                zip.closeEntry();
            }
        }
    }

    private static String entryName(final MultipartFile file)
    {
        // Browsers may send a path; keep only the file name so entries can't escape the archive root
        final String name = StringUtils.getFilename(StringUtils.cleanPath(String.valueOf(file.getOriginalFilename())));
        return StringUtils.hasText(name) ? name : "file";
    }

    private static String uniqueName(final String name, final Set<String> usedNames)
    {
        String candidate = name;
        for(int i = 2; !usedNames.add(candidate); i++)
        {
            final String extension = StringUtils.getFilenameExtension(name);
            candidate = extension == null
                ? name + " (" + i + ")"
                : StringUtils.stripFilenameExtension(name) + " (" + i + ")." + extension;
        }
        return candidate;
    }
}
