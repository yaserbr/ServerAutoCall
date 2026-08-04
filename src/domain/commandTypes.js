const COMMAND_ACTION_TO_TYPE = Object.freeze({
  call: "CALL",
  end: "END",
  sms: "SMS",
  auto_answer: "AUTO_ANSWER",
  open_url: "OPEN_URL",
  close_webview: "CLOSE_WEBVIEW",
  open_app: "OPEN_APP",
  return_to_autocall: "RETURN_TO_AUTOCALL",
  download_data: "DOWNLOAD_DATA",
  activate_esim: "ACTIVATE_ESIM",
  delete_esim: "DELETE_ESIM",
  start_screen_mirror: "START_SCREEN_MIRROR",
  stop_screen_mirror: "STOP_SCREEN_MIRROR",
  screen_touch: "SCREEN_TOUCH",
  screen_swipe: "SCREEN_SWIPE"
});

const COMMAND_TYPE_TO_ACTION = Object.freeze(
  Object.fromEntries(
    Object.entries(COMMAND_ACTION_TO_TYPE).map(([action, type]) => [type, action])
  )
);

const COMMAND_ACTIONS = Object.freeze(Object.keys(COMMAND_ACTION_TO_TYPE));
const COMMAND_TYPES = Object.freeze(Object.values(COMMAND_ACTION_TO_TYPE));

module.exports = {
  COMMAND_ACTION_TO_TYPE,
  COMMAND_TYPE_TO_ACTION,
  COMMAND_ACTIONS,
  COMMAND_TYPES
};
