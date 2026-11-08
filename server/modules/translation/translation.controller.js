const translationService = require("./translation.service");

const translationController = {
  async translateText(req, res, next) {
    try {
      const { text, sourceLang, targetLang } = req.body;
      const result = await translationService.translate(text, sourceLang, targetLang);
      res.json({ status: "success", data: result });
    } catch (err) { next(err); }
  },

  async translateMessage(req, res, next) {
    try {
      const { messageId } = req.params;
      const { targetLang } = req.body;
      const translation = await translationService.translateMessage(messageId, targetLang);
      res.json({ status: "success", data: { translation } });
    } catch (err) { next(err); }
  },

  async getMessageTranslations(req, res, next) {
    try {
      const translations = await translationService.getMessageTranslations(req.params.messageId);
      res.json({ status: "success", data: { translations } });
    } catch (err) { next(err); }
  },
};

module.exports = translationController;
