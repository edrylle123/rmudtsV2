This folder is part of the RMUDTS release archive layout.

The installation wizard does NOT store application data here: storing .env,
config.php, logs, uploads or backups inside public_html would expose them over
HTTP. Instead it creates and uses:

  /home/<account>/rmudts-app       Node.js backend
  /home/<account>/rmudts-config    .env, config.php, installed.lock copy
  /home/<account>/rmudts-data      application data, temp files, cache
  /home/<account>/rmudts-logs      application and installer logs
  /home/<account>/rmudts-uploads   user uploads
  /home/<account>/rmudts-backups   database and upload backups
  /home/<account>/rmudts-restore   restore staging

See docs/INSTALL.md for the full walkthrough.
