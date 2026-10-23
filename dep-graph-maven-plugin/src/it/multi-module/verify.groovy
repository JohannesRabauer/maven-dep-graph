import groovy.json.JsonSlurper

File page = new File(basedir, "target/dep-graph.html")
assert page.exists() : "the execution root did not write dep-graph.html"
assert !new File(basedir, "a/target/dep-graph.html").exists() : "module a wrote its own page"

String html = page.getText("UTF-8")
String open = 'id="dep-graph-data">'
int start = html.indexOf(open) + open.length()
def data = new JsonSlurper().parseText(html.substring(start, html.indexOf("</script>", start)))

String idA = "dev.rabauer.it:a:1.0-SNAPSHOT"
String idB = "dev.rabauer.it:b:1.0-SNAPSHOT"
String idApp = "dev.rabauer.it:app:1.0-SNAPSHOT"

// Edges address nodes by index, so resolve them through the id table first.
def ids = data.nodes.collect { it.id } + (data.extraIds ?: [])
assert ids.contains(idA) : "node for module a is missing"
assert ids.contains(idB) : "node for module b is missing"
assert ids.contains(idApp) : "node for module app is missing"

def edges = data.edges.collect { [ids[it[0]], ids[it[1]]] }
assert edges.contains([idApp, idA]) : "no edge from app to a"

String log = new File(basedir, "build.log").getText("UTF-8")
int skips = log.count("Dependency graph is written once, from")
assert skips == 1 : "the skip should be logged once at info level, got " + skips
