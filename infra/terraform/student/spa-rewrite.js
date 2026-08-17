function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (
    uri === "/" ||
    uri === "/console" ||
    uri.indexOf("/console/") === 0 ||
    uri.indexOf("/start/") === 0 ||
    uri.indexOf("/review/") === 0
  ) {
    request.uri = "/index.html";
  }
  return request;
}
