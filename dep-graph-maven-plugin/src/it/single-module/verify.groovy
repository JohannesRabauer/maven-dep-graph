import groovy.json.JsonSlurper

File page = new File(basedir, "target/dep-graph.html")
assert page.exists() : "dep-graph.html was not written"

String html = page.getText("UTF-8")
String open = 'id="dep-graph-data">'
int start = html.indexOf(open) + open.length()
def data = new JsonSlurper().parseText(html.substring(start, html.indexOf("</script>", start)))

def statuses = data.edges.collect { data.statusNames[it[4] & 3] } as Set
assert statuses.contains("MANAGED") : "no MANAGED edge in the page"
assert statuses.contains("DROPPED") : "no DROPPED edge in the page"

def scopes = data.edges.collect { it[3] >= 0 ? data.scopeNames[it[3]] : null } as Set
assert scopes.contains("test") : "no test scoped edge in the page"

assert !html.contains('src="http') : "the page references an external resource"
