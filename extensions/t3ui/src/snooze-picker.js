export function showSnoozePicker({ root, element, button, copy, title, choose }) {
  const dialog = element("dialog", "picker");
  const form = element("form", "picker-form");
  const heading = element("h2", "picker-heading");
  const chat = element("p", "picker-chat");
  heading.id = "t3ui-snooze-heading";
  heading.textContent = copy.snoozeChat;
  chat.id = "t3ui-snooze-chat";
  chat.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.setAttribute("aria-describedby", chat.id);

  function select(wakeAt) {
    dialog.close();
    choose(wakeAt);
  }

  const presets = element("div", "picker-presets");
  const hour = button("preset");
  hour.textContent = copy.oneHour;
  hour.autofocus = true;
  hour.addEventListener("click", () => select(Date.now() + 60 * 60 * 1000));
  const tomorrow = button("preset");
  tomorrow.textContent = copy.tomorrow;
  tomorrow.addEventListener("click", () => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    select(date.getTime());
  });
  presets.append(hour, tomorrow);

  const custom = element("label", "picker-custom");
  const input = element("input", "picker-date");
  input.type = "datetime-local";
  input.required = true;
  input.addEventListener("input", () => input.setCustomValidity(""));
  custom.append(copy.customTime, input);

  const footer = element("div", "picker-footer");
  const cancel = button("cancel");
  const confirm = button("confirm");
  cancel.textContent = copy.cancel;
  cancel.addEventListener("click", () => dialog.close());
  confirm.type = "submit";
  confirm.textContent = copy.snooze;
  footer.append(cancel, confirm);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const date = new Date(input.value);
    const wakeAt = date.getTime();
    // A local time that falls in a daylight-saving gap is normalized by Date.
    const [, hours, minutes] = /T(\d\d):(\d\d)/.exec(input.value) ?? [];
    if (!(wakeAt > Date.now()) || date.getHours() !== Number(hours) || date.getMinutes() !== Number(minutes)) {
      input.setCustomValidity(copy.invalidTime);
      input.reportValidity();
      return;
    }
    select(wakeAt);
  });
  form.append(heading, chat, presets, custom, footer);
  dialog.append(form);
  root.append(dialog);
  dialog.showModal();
  return dialog;
}
