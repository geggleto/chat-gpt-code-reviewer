import {main} from "./src/lib.js";
import * as core from "@actions/core";

const TOKEN_USE = parseInt(core.getInput("TOKEN_USE") ?? 700);
const GITHUB_TOKEN = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL = core.getInput("OPENAI_API_MODEL") ?? '';

main(TOKEN_USE, GITHUB_TOKEN, OPENAI_API_KEY, OPENAI_API_MODEL).catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});
