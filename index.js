const core = require("@actions/core");
const io = require("@actions/io");
const https = require("https");
const parser = require("node-html-parser");
const scparser = require("set-cookie-parser");
const fs = require("fs");
const yauzl = require("yauzl-promise");
const { default: simpleGit } = require("simple-git");

//global variables
var foldernameindex = {};
var number_of_unzipped = 0;

// most @actions toolkit packages have async methods
async function run() {
  try {
    const email = core.getInput("email", { required: true });
    const password = core.getInput("password", { required: true });
    const repotoken = core.getInput("repotoken", { required: true });
    const repository = core.getInput("reponame", { required: true });
    const gituser = core.getInput("gituser", { required: true });
    const gitemail = core.getInput("gitemail", { required: true });

    const start = new Date();
    core.debug("start time: " + new Date().toTimeString()); // debug is only output if you set the secret `ACTIONS_RUNNER_DEBUG` to true

    var logindata = await login(email, password);
    var allprojects = await parse_projects(logindata.projects);
    var activeprojects = allprojects.filter(
      (project) => !(project.archived || project.trashed)
    );
    core.info(`found ${activeprojects.length} active projects.`);
    foldernameindex = make_index(activeprojects);
    await clone_repo(repository, repotoken);
    await new Promise((resolve2) => {for (project in activeprojects) {
      download_project(
        activeprojects[project],
        logindata.session,
        logindata.gclb,
        resolve2,
        activeprojects.length
      );
    }});
    await commit_and_push(repository, repotoken, gituser, gitemail);

    core.debug("end time: " + new Date().toTimeString());
    const end = new Date();
    const time = end - start;
    core.setOutput("time", time);
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function clone_repo(repository, repotoken) {
  const options = {
    baseDir: process.cwd(),
    binary: "git",
    maxConcurrentProcesses: 6
  };
  const git = simpleGit(options);
  await git.clone(`https://jmir1:${repotoken}@github.com/${repository}.git`, "projects");
}

async function commit_and_push(repository, repotoken, username, email) {
  const options = {
    baseDir: process.cwd() + "/projects",
    binary: "git",
    maxConcurrentProcesses: 6
  };
  const git = simpleGit(options);
  const commitoptions = {"--author": `${username} <${email}>`}
  await git.add(".")
  console.log(await git.commit("update repo", commitoptions));
  console.log(await git.push(`https://${username}:${repotoken}@github.com/${repository}.git`));
}

async function login(email, password) {
  //GET login page
  const get = await get_login();
  //get necessary info from response
  const csrf = parser
    .parse(get.html)
    .querySelector(`meta[name="ol-csrfToken"]`)
    .getAttribute("content");
  const session1 = scparser(get.headers["set-cookie"], {
    decodeValues: false
  }).find((cookie) => cookie.name == "overleaf_session2").value;
  const gclb = scparser(get.headers["set-cookie"], {
    decodeValues: false
  }).find((cookie) => cookie.name == "GCLB").value;

  //POST login data
  const post = await post_login(csrf, email, password, session1, gclb);
  //get necessary data from response
  const session2 = scparser(post["set-cookie"], { decodeValues: false }).find(
    (cookie) => cookie.name == "overleaf_session2"
  ).value;

  //GET new csrf token from project page
  const projects = await get_projects(session2, gclb);
  const csrf2 = parser
    .parse(projects.html)
    .querySelector(`meta[name="ol-csrfToken"]`)
    .getAttribute("content");

  //return data
  return {
    session: session2,
    gclb: gclb,
    csrf: csrf2,
    projects: projects.html
  };
}

async function parse_projects(html) {
  const projectstr = parser
    .parse(html)
    .querySelector("meta[name=ol-projects]")
    .getAttribute("content");
  return JSON.parse(projectstr);
}

async function download_project(
  project,
  session,
  gclb,
  resolve2,
  number_to_unzip
) {
  io.mkdirP("zippedprojects");
  const file = fs.createWriteStream(`zippedprojects/${project.id}.zip`);
  const options = {
    headers: { Cookie: `overleaf_session2=${session}; GCLB=${gclb}` }
  };
  await new Promise((resolve) => {
    https.get(
      `https://www.overleaf.com/project/${project.id}/download/zip`,
      options,
      function (response) {
        response.pipe(file);
        response.on("end", () => {
          unzip_project(project, resolve);
        });
      }
    );
  });
  number_of_unzipped++;
  if (number_of_unzipped == number_to_unzip) resolve2();
}

async function unzip_project(project, resolve) {
  const foldername = foldernameindex[project.id];
  io.mkdirP(`projects/${foldername}`);
  const zipFile = await yauzl.open(`zippedprojects/${project.id}.zip`);
  await zipFile.walkEntries(async function (entry) {
    const readStream = await zipFile.openReadStream(entry);
    readStream.pipe(
      fs.createWriteStream(`projects/${foldername}/${entry.fileName}`)
    );
  });
  await zipFile.close();
  resolve();
}

function make_index(projects) {
  var index = {};
  for (project in projects) {
    let dupenum = Object.entries(index).filter(
      ([id, name]) => name == projects[project].name
    ).length;
    let suffix = dupenum > 0 ? `_(${dupenum})` : "";
    let foldername = projects[project].name.replace(/ /g, "_") + suffix;
    let projid = projects[project].id;
    index[projid] = foldername;
  }
  return index;
}

async function get_login() {
  const url = "https://www.overleaf.com/login";
  return new Promise((resolve) => {
    https.get(url, (res) => {
      var data;
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ html: data, headers: res.headers });
      });
    });
  });
}

async function get_projects(session2, gclb) {
  const url = "https://www.overleaf.com/project";
  return new Promise((resolve) => {
    https.get(
      url,
      { headers: { Cookie: `GCLB=${gclb};overleaf_session2=${session2}` } },
      (res) => {
        var data;
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ html: data, headers: res.headers });
        });
      }
    );
  });
}

async function post_login(_csrf, email, password, session1, gclb) {
  const url = "https://www.overleaf.com/login";
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `GCLB=${gclb};overleaf_session2=${session1}`
    }
  };
  const postData = {
    _csrf: _csrf,
    email: email,
    password: password
  };
  return new Promise((resolve) => {
    var req = https.request(url, options, (res) => {
      resolve(res.headers);
    });

    req.on("error", (e) => {
      console.error(e);
    });

    req.write(JSON.stringify(postData));
    req.end();
  });
}

run();
