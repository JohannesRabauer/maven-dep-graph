package dev.rabauer.demo;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipInputStream;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import dev.rabauer.demo.core.Zipper;

class ZipControllerTest
{
    private final ZipController controller = new ZipController(new Zipper(), DataSize.ofMegabytes(100));

    @Test
    void streamsUploadedFilesAsNamedZip() throws IOException
    {
        final List<MultipartFile> files = List.of(
            new MockMultipartFile("files", "notes.txt", "text/plain", "hi".getBytes(StandardCharsets.UTF_8)));

        final ResponseEntity<StreamingResponseBody> response = this.controller.zip(files, " holiday ");

        assertThat(response.getHeaders().getContentDisposition().getFilename()).isEqualTo("holiday.zip");
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        response.getBody().writeTo(out);
        try(final ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(out.toByteArray())))
        {
            assertThat(zip.getNextEntry().getName()).isEqualTo("notes.txt");
        }
    }

    @Test
    void rejectsEmptyUpload()
    {
        assertThat(this.controller.zip(List.of(), "x").getStatusCode().is4xxClientError()).isTrue();
    }
}
