package com.example.contentops;

import com.example.contentops.application.ContentService;
import com.example.contentops.cli.CliRunner;
import com.example.contentops.infrastructure.JsonSupport;
import com.example.contentops.infrastructure.mock.JsonMockGateway;
import com.example.contentops.infrastructure.mock.JsonStateStore;
import com.example.contentops.infrastructure.mock.FaultInjectingGateway;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

public final class Main {
    private Main() { }
    public static void main(String[] args) {
        var json = JsonSupport.create();
        var out = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
        var err = new PrintWriter(new OutputStreamWriter(System.err, StandardCharsets.UTF_8), true);
        // The factory is invoked only after parsing; help never opens a store or reads configuration.
        var runner = new CliRunner(System.getenv(), out, err, json, config -> {
            var mock = new JsonMockGateway(new JsonStateStore(config.stateDirectory(), json), json);
            if (!config.mockScenario().active()) { return new ContentService(mock); }
            var faults = new FaultInjectingGateway(mock, config.mockScenario());
            return new ContentService(faults, faults::diagnosticWarnings);
        });
        System.exit(runner.run(args));
    }
}
