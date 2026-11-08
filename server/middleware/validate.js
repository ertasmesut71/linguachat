const { ZodError } = require("zod");
const ApiError = require("../utils/ApiError");

/**
 * Creates a middleware that validates req.body (or req.query/req.params)
 * against a Zod schema.
 *
 * @param {import('zod').ZodSchema} schema
 * @param {'body' | 'query' | 'params'} source
 */
function validate(schema, source = "body") {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed; // replace with parsed/cleaned data
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        }));
        next(ApiError.badRequest("Validation failed", details));
      } else {
        next(err);
      }
    }
  };
}

module.exports = { validate };
