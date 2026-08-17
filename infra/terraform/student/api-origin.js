function handler(event) {
  var request = event.request;
  request.headers["x-review-public-origin"] = {
    value: "https://" + request.headers.host.value,
  };
  return request;
}
