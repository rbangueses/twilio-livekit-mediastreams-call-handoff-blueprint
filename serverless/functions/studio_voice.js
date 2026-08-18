const { connectLiveKitCall } = requireFunction("/lib/livekit-connector", "./lib/livekit-connector.private");

exports.handler = function (context, event, callback) {
  return connectLiveKitCall(context, event, callback, {
    route: "studio",
    logPrefix: "studio_voice",
  });
};

function requireFunction(functionPath, localPath) {
  if (typeof Runtime !== "undefined" && Runtime.getFunctions) {
    const functions = Runtime.getFunctions();
    const normalized = functionPath.startsWith("/") ? functionPath : `/${functionPath}`;
    const candidates = [normalized, normalized.slice(1), functionPath];
    const entry =
      candidates.map((key) => functions[key]).find(Boolean) ||
      Object.entries(functions).find(([key]) =>
        candidates.some((candidate) => key === candidate || key.endsWith(candidate)),
      )?.[1];

    if (!entry?.path) {
      throw new Error(`Private Function not found for ${functionPath}`);
    }

    return require(entry.path);
  }

  return require(localPath);
}
