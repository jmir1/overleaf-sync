# overleaf-sync action
sync your overleaf projects with github!
# DOESN'T WORK ANYMORE BECAUSE OVERLEAF RECENTLY INTRODUCED A NECESSARY CAPTCHA FOR LOGGING IN
# USAGE:
- create two repository secrets in the repo you want to sync your projects in:  
`INPUT_EMAIL` and `INPUT_PASSWORD` containing your overleaf email and password
- create a workflow file in e.g. `.github/workflows/sync.yml` with the following content:
```yml
name: sync overleaf projects
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

jobs:
  syncprojects:
    runs-on: ubuntu-latest
    steps:
      - name: overleaf-sync
        uses: jmir1/overleaf-sync@0.0.1
        with:
          email: ${{ SECRETS.INPUT_EMAIL }}
          password: ${{ SECRETS.INPUT_PASSWORD }}
          repotoken: ${{ SECRETS.GITHUB_TOKEN }}
          gituser: ${{ github.actor }}
          reponame: ${{ github.repository }}
          gitemail: "${{ github.actor }}@users.noreply.github.com"
```

this will sync your projects every 15 minutes or you can run it manually from the actions tab. enjoy! :D
