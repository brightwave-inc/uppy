import * as logger from '../logger.js'
import {
  ProviderApiError,
  ProviderAuthError,
  ProviderNotFoundError,
  ProviderPermissionError,
  ProviderUserError,
  parseHttpError,
} from './error.js'

export { parseHttpError }

/**
 *
 * @param {{
 *   fn: () => any,
 *   tag: string,
 * providerName: string,
 *   requestContext?: object,
 *   isAuthError?: (a: { statusCode: number, body?: object }) => boolean,
 * isNotFoundError?: (a: { statusCode: number, body?: object }) => boolean,
 * isPermissionError?: (a: { statusCode: number, body?: object }) => boolean,
 * isUserFacingError?: (a: { statusCode: number, body?: object }) => boolean,
 *   getJsonErrorMessage: (a: object) => string
 * }} param0
 * @returns
 */
export async function withProviderErrorHandling({
  fn,
  tag,
  providerName,
  requestContext = {},
  isAuthError = () => false,
  isNotFoundError = () => false,
  isPermissionError = () => false,
  isUserFacingError = () => false,
  getJsonErrorMessage,
}) {
  function getErrorMessage({ statusCode, body }) {
    if (typeof body === 'object') {
      const message = getJsonErrorMessage(body)
      if (message != null) return message
    }

    if (typeof body === 'string') {
      return body
    }

    return `request to ${providerName} returned ${statusCode}`
  }

  try {
    return await fn()
  } catch (err) {
    const httpError = parseHttpError(err)

    // Wrap all HTTP errors according to the provider's desired error handling
    if (httpError) {
      const { statusCode, body } = httpError
      let knownErr

      if (isAuthError({ statusCode, body })) {
        knownErr = new ProviderAuthError()
      } else if (isNotFoundError({ statusCode, body })) {
        const message = getErrorMessage({ statusCode, body })
        knownErr = new ProviderNotFoundError(
          message,
          statusCode,
          requestContext,
        )
      } else if (isPermissionError({ statusCode, body })) {
        const message = getErrorMessage({ statusCode, body })
        knownErr = new ProviderPermissionError(
          message,
          statusCode,
          requestContext,
        )
      } else if (isUserFacingError({ statusCode, body })) {
        knownErr = new ProviderUserError({
          message: getErrorMessage({ statusCode, body }),
        })
      } else {
        knownErr = new ProviderApiError(
          getErrorMessage({ statusCode, body }),
          statusCode,
        )
      }

      // Enhanced structured logging with context
      logger.error(
        {
          error: knownErr.message,
          statusCode,
          provider: providerName,
          operation: requestContext.operation,
          directory: requestContext.directory,
          itemId: requestContext.id,
          query: requestContext.query,
        },
        tag,
      )
      throw knownErr
    }

    // non HTTP errors will be passed through
    logger.error(err, tag)
    throw err
  }
}

export async function withGoogleErrorHandling(providerName, tag, fn) {
  return withProviderErrorHandling({
    fn,
    tag,
    providerName,
    isAuthError: (response) =>
      response.statusCode === 401 ||
      (response.statusCode === 400 && response.body?.error === 'invalid_grant'), // Refresh token has expired or been revoked
    getJsonErrorMessage: (body) => body?.error?.message,
  })
}
