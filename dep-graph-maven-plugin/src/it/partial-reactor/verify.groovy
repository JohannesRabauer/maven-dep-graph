import groovy.json.JsonSlurper

File page = new File(basedir, "target/dep-graph.html")
assert page.exists() : "-pl b wrote no page at the execution root"
assert !new File(basedir, "b/target/dep-graph.html").exists() :
        "the page landed in the last reactor module instead of the execution root"

String html = page.getText("UTF-8")
String open = 'id="dep-graph-data">'
int start = html.indexOf(open) + open.length()
def data = new JsonSlurper().parseText(html.substring(start, html.indexOf("</script>", start)))

assert data.modules.collect { it.name } == ["b"] :
        "the page should cover exactly the requested reactor, got " + data.modules

String log = new File(basedir, "build.log").getText("UTF-8")
int skips = log.count("Dependency graph is written once, from")
assert skips == 0 : "a single-project reactor has nothing to skip, got " + skips
