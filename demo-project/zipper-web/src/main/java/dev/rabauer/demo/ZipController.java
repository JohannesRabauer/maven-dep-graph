package dev.rabauer.demo;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.util.unit.DataSize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import dev.rabauer.demo.core.Zipper;

@Controller
public class ZipController
{
    private final Zipper zipper;
    private final DataSize maxRequestSize;

    public ZipController(
        final Zipper zipper,
        @Value("${spring.servlet.multipart.max-request-size}") final DataSize maxRequestSize)
    {
        this.zipper = zipper;
        this.maxRequestSize = maxRequestSize;
    }

    @GetMapping("/")
    public String index(final Model model)
    {
        model.addAttribute("maxSizeMb", this.maxRequestSize.toMegabytes());
        return "index";
    }

    @PostMapping("/zip")
    public ResponseEntity<StreamingResponseBody> zip(
        @RequestParam("files") final List<MultipartFile> files,
        @RequestParam(name = "name", defaultValue = "archive") final String name)
    {
        if(files.isEmpty())
        {
            return ResponseEntity.badRequest().build();
        }
        final String fileName = (name.isBlank() ? "archive" : name.strip()) + ".zip";
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType("application/zip"))
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(fileName).build().toString())
            .body(out -> this.zipper.zip(entries(files), out));
    }

    private static List<Zipper.Entry> entries(final List<MultipartFile> files)
    {
        return files.stream()
            .map(file -> new Zipper.Entry(file.getOriginalFilename(), file::getInputStream))
            .toList();
    }
}
