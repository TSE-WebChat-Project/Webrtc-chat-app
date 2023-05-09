import "./styles/main.scss";

$("#create-btn").click(() => {
  let code = Math.floor(Math.random() * 1000000);
  window.location.href = "/chat.html?room=" + code;
});

$("#join-btn").click(() => {
  window.location.href = "/chat.html?room=" + $("#code-input").val();
});
