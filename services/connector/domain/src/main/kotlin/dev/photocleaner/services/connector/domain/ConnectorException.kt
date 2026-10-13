package dev.photocleaner.services.connector.domain

/** Why a connector call failed. Messages never contain session material or photo content. */
sealed class ConnectorException(message: String) : Exception(message) {
    class NotConnected(message: String = "The browser extension is not connected") : ConnectorException(message)
    class NoPhotosTab(message: String) : ConnectorException(message)
    class SessionExpired(message: String, val httpStatus: Int?) : ConnectorException(message)
    class RateLimited(message: String, val httpStatus: Int?, val rpcCode: Int?) : ConnectorException(message)
    class Transient(message: String, val httpStatus: Int?) : ConnectorException(message)
    class RpcFailed(message: String, val httpStatus: Int?, val rpcCode: Int?) : ConnectorException(message)
    class ProtocolMismatch(message: String) : ConnectorException(message)
    class PreviewUnavailable(message: String, val httpStatus: Int?) : ConnectorException(message)
    class BadRequest(message: String) : ConnectorException(message)
    class Timeout(operation: String) : ConnectorException("No answer from the extension for $operation")
}
