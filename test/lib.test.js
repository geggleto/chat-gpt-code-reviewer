import 'dotenv/config'
import {assert} from "chai";
import { getPRDetails, init, getDiff, filterFiles, createPrompt, getAIResponse, createComment } from "../src/lib.js";
import {writeFileSync} from "fs";
import parseDiff from "parse-diff";


describe('Main Library', function () {
    this.timeout(60000);

    init(700, process.env.GITHUB_TOKEN, process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL);
    const repository = {
        owner: {
            login: "slimphp"
        },
        name: "Slim"
    };
    const pull_number = 3259;

    it('should be able to pull details about a pull request', async ()=> {
        let result = await getPRDetails(repository, pull_number);

        assert.isObject(result, 'prObject is an object');
        assert.strictEqual(result.owner, 'slimphp', 'Owner should be user123');
        assert.strictEqual(result.repo, 'Slim', 'Repo should be my-repo');
        assert.strictEqual(result.pull_number, 3259, 'Pull number should be 42');
        assert.isString(result.title);
        assert.isString(result.description);
    });

    it('should retreive the diff', async () => {
        let result = await getDiff(repository.owner.login, repository.name, pull_number);
        writeFileSync("./diff.log", result);
        assert.isString(result);
    });

    it('should filter the diff', async () => {
        let result = await getDiff(repository.owner.login, repository.name, pull_number);
        let files = parseDiff(result);
        writeFileSync("./parseDiff.log", JSON.stringify(files));

        let filteredFiles = filterFiles(files);
        assert.lengthOf(filteredFiles, files.length, 'Array has the same elements');
    });

    it('should create a prompt and should get a response from chat-gpt and generate some comments',  async () => {
        let prResult = await getPRDetails(repository, pull_number);
        let result = await getDiff(repository.owner.login, repository.name, pull_number);
        let files = parseDiff(result);
        let filteredFiles = filterFiles(files);
        let file = filteredFiles.pop();
        let chunk = file.chunks.pop();

        let prompt = createPrompt(file, chunk, prResult);
        assert.isString(prompt);

        let reviews = await getAIResponse(prompt);
        assert.isAbove(reviews.length, 0, 'Array length is greater than 0');
        for(let r of reviews) {
            assert.hasAllKeys(r, ['lineNumber', 'reviewComment'])
        }

        let comments = createComment(file, reviews);
        for(let r of comments) {
            assert.hasAllKeys(r, ['body', 'path', 'line'])
        }
    });
});