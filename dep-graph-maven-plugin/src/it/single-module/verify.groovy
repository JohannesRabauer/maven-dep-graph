File page = new File(basedir, "target/dep-graph.html")
assert page.exists() : "dep-graph.html was not written"

String html = page.getText("UTF-8")
assert html.contains('"status":"MANAGED"') : "no MANAGED edge in the page"
assert html.contains('"status":"DROPPED"') : "no DROPPED edge in the page"
assert html.contains('"scope":"test"') : "no test scoped edge in the page"
assert !html.contains('src="http') : "the page references an external resource"
