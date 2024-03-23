import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff from "parse-diff";
import { extname } from "path";

const fileExtensions = ['.js', '.java', '.php'];

let TOKEN_USE, OPENAI_API_MODEL, GITHUB_TOKEN, OPENAI_API_KEY, octokit, openai;

export async function getPRDetails(repository, number) {
  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
}

export async function getDiff(
  owner,
  repo,
  pull_number
) {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });

  return response.data;
}

export async function analyzeAndGenerateComments(
  parsedDiff,
  prDetails
){
  const comments = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") continue; // Ignore deleted files
    for (const chunk of file.chunks) {
      const prompt = createPrompt(file, chunk, prDetails);
      const aiResponse = await getAIResponse(prompt);
      console.debug("response: ", aiResponse);
      if (aiResponse) {
        const newComments = createComment(file, aiResponse);
        if (newComments) {
          comments.push(...newComments);
        }
      }
    }
  }
  return comments;
}

export function createPrompt(file, chunk, prDetails) {
  return `Your task is to review pull requests. Instructions:
- Provide the response in following JSON format:  {"reviews": [{"lineNumber":  <line_number>, "reviewComment": "<review comment>"}]}
- Do not give positive comments or compliments.
- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
- IMPORTANT: NEVER suggest adding comments to the code.

Review the following code diff in the file "${
    file.to
  }" and take the pull request title and description into account when writing the response.
  
Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

Git diff to review:

\`\`\`diff
${chunk.content}
${chunk.changes
  // @ts-expect-error - ln and ln2 exists where needed
  .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
  .join("\n")}
\`\`\`
`;
}

export async function getAIResponse(prompt) {
  const queryConfig = {
    model: OPENAI_API_MODEL,
    temperature: 0.2,
    max_tokens: TOKEN_USE,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  };

  try {
    const config = {
      ...queryConfig,
      messages: [{ role: "system", content: prompt }],
    };

    if (OPENAI_API_MODEL === "gpt-4-1106-preview") {
      config.response_format = { type: "json_object" };
    }

    const response = await openai.chat.completions.create(config);

    const res = response.choices[0].message?.content?.trim() || null;
    if (res) {
      return JSON.parse(res).reviews;
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error:", error);
    return null;
  }
}

export function createComment(
  file,
  aiResponses
) {
  return aiResponses.flatMap((aiResponse) => {
    if (!file.to) {
      return [];
    }
    return {
      body: aiResponse.reviewComment,
      path: file.to,
      line: Number(aiResponse.lineNumber),
    };
  });
}

export async function createReviewComment(
  owner,
  repo,
  pull_number,
  comments
) {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments,
    event: "COMMENT",
  });
}

export function init(_TOKEN_USE, _GITHUB_TOKEN, _OPENAI_API_KEY, _OPENAI_API_MODEL) {
  OPENAI_API_MODEL = _OPENAI_API_MODEL;
  TOKEN_USE = _TOKEN_USE;
  GITHUB_TOKEN = _GITHUB_TOKEN;
  OPENAI_API_KEY = _OPENAI_API_KEY;

  octokit = new Octokit({ auth: GITHUB_TOKEN });

  openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });
}

export function filterFiles(diffFiles) {
  return diffFiles.filter((diffFile) => {
    let fileName = diffFile.to || "";
    if (fileName === "") {
      return false;
    }
    let ext = extname(fileName);
    return !(fileExtensions.indexOf(ext) === -1)
  });
}

export async function main(_TOKEN_USE, _GITHUB_TOKEN, _OPENAI_API_KEY, _OPENAI_API_MODEL) {
  init(_TOKEN_USE, _GITHUB_TOKEN, _OPENAI_API_KEY, _OPENAI_API_MODEL);

  const eventData = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  const prDetails = await getPRDetails(eventData.repository, eventData.number);

  let diff;

  if (eventData.action === "opened") {
    diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
    );
  } else if (eventData.action === "synchronize") {
    const newBaseSha = eventData.before;
    const newHeadSha = eventData.after;

    const response = await octokit.repos.compareCommits({
      headers: {
        accept: "application/vnd.github.v3.diff",
      },
      owner: prDetails.owner,
      repo: prDetails.repo,
      base: newBaseSha,
      head: newHeadSha,
    });

    diff = String(response.data);
  } else {
    console.debug("Unsupported event:", process.env.GITHUB_EVENT_NAME);
    process.exit(1);
  }

  if (!diff) {
    console.debug("No diff found");
    process.exit(1);
  }

  const parsedDiff = parseDiff(diff);
  const filteredDiff = filterFiles(parsedDiff);

  const comments = await analyzeAndGenerateComments(filteredDiff, prDetails);
  if (comments.length > 0) {
    await createReviewComment(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number,
      comments
    );
  }
}