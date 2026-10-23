package dev.rabauer.demo.cli;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.apache.commons.cli.CommandLine;
import org.apache.commons.cli.DefaultParser;
import org.apache.commons.cli.HelpFormatter;
import org.apache.commons.cli.Option;
import org.apache.commons.cli.Options;
import org.apache.commons.cli.ParseException;

import dev.rabauer.demo.core.Zipper;

/** {@code zipper -o archive.zip file...} */
public final class ZipperCli
{
    private ZipperCli()
    {
    }

    public static void main(final String[] args) throws IOException
    {
        final Options options = new Options()
            .addOption(Option.builder("o").longOpt("output").hasArg().argName("file")
                .desc("archive to write (default: archive.zip)").build())
            .addOption("h", "help", false, "show this help");
        final CommandLine cli;
        try
        {
            cli = new DefaultParser().parse(options, args);
        }
        catch(final ParseException e)
        {
            System.err.println(e.getMessage());
            System.exit(2);
            return;
        }
        if(cli.hasOption("h") || cli.getArgList().isEmpty())
        {
            new HelpFormatter().printHelp("zipper [options] file...", options);
            return;
        }

        final List<Zipper.Entry> entries = cli.getArgList().stream()
            .map(Path::of)
            .map(path -> new Zipper.Entry(path.getFileName().toString(), () -> Files.newInputStream(path)))
            .toList();
        final Path target = Path.of(cli.getOptionValue("o", "archive.zip"));
        try(final OutputStream out = Files.newOutputStream(target))
        {
            new Zipper().zip(entries, out);
        }
        System.out.println("Wrote " + entries.size() + " file(s) to " + target);
    }
}
