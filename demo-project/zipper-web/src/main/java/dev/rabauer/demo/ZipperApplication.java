package dev.rabauer.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

import dev.rabauer.demo.core.Zipper;

@SpringBootApplication
public class ZipperApplication
{
    public static void main(final String[] args)
    {
        SpringApplication.run(ZipperApplication.class, args);
    }

    @Bean
    Zipper zipper()
    {
        return new Zipper();
    }
}
