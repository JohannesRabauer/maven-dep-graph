document.querySelectorAll('[data-copy]').forEach(function (block) {
  if (!navigator.clipboard) return;
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.textContent = 'Copy';
  button.addEventListener('click', function () {
    navigator.clipboard.writeText(block.querySelector('code').textContent).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy'; }, 1500);
    });
  });
  block.appendChild(button);
});
