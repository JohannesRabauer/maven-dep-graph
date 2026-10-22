File page = new File(basedir, "target/dep-graph.html")
assert page.exists() : "the execution root did not write dep-graph.html"
assert !new File(basedir, "a/target/dep-graph.html").exists() : "module a wrote its own page"

String html = page.getText("UTF-8")
String idA = "dev.rabauer.it:a:1.0-SNAPSHOT"
String idB = "dev.rabauer.it:b:1.0-SNAPSHOT"
String idApp = "dev.rabauer.it:app:1.0-SNAPSHOT"

assert html.contains('"id":"' + idA + '"') : "node for module a is missing"
assert html.contains('"id":"' + idB + '"') : "node for module b is missing"
assert html.contains('"id":"' + idApp + '"') : "node for module app is missing"

assert html =~ /"from":"\Q${idApp}\E","to":"\Q${idA}\E"/ : "no edge from app to a"
