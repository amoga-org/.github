const { Octokit } = require("@octokit/rest");
const fs = require("fs").promises;

const README_FILE_PATH = "profile/README.md";

// Threshold for considering a repository as "recently updated" (in days)
const RECENT_UPDATE_THRESHOLD_DAYS = 3;

/**
 * Main function that orchestrates the entire README update process.
 */
async function main() {
    try {
        // Initialize GitHub API client with authentication token from environment
        const octokit = initializeOctokit();

        // Get organization name from environment variable or use default "amoga-io"
        const orgName = getOrganizationName();

        // Fetch all repositories from the organization using GitHub API pagination
        const repos = await getAllRepos(octokit, orgName);

        // Filter out archived repos and sort
        const activeRepos = repos.filter((repo) => !repo.archived);
        const sortedRepos = sortRepositories(activeRepos, true);

        // Build header section with welcome message
        const header = buildHeaderSection();

        // Build public repositories table with link column
        const reposSection = buildRepositoriesSection(sortedRepos);

        // Build footer section with auto-generation notice
        const footer = buildFooterSection();

        // Combine all sections into complete README markdown content
        const readmeContent = assembleReadme(header, reposSection, footer);

        // Write the assembled README content to file
        await writeReadme(readmeContent);
    } catch (error) {
        console.error("Error during README update:", error.message);
        process.exit(1);
    }
}

/**
 * Initialize and configure the Octokit GitHub API client.
 */
function initializeOctokit() {
    const options = {};
    if (process.env.GITHUB_TOKEN) {
        options.auth = process.env.GITHUB_TOKEN;
    }
    return new Octokit(options);
}

/**
 * Get the target organization name from environment variables with fallback.
 */
function getOrganizationName() {
    return process.env.ORG_NAME || "amoga-org";
}

/**
 * Calculate and format relative time from a given date to now (e.g., "3 days ago", "1 month ago").
 */
function getRelativeTime(date) {
    const now = new Date();
    const target = new Date(date);
    const diffMs = now - target;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffDays === 0) {
        return "today";
    } else if (diffDays === 1) {
        return "1 day ago";
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else if (diffWeeks === 1) {
        return "1 week ago";
    } else if (diffWeeks < 4) {
        return `${diffWeeks} weeks ago`;
    } else if (diffMonths === 1) {
        return "1 month ago";
    } else if (diffMonths < 12) {
        return `${diffMonths} months ago`;
    } else if (diffYears === 1) {
        return "1 year ago";
    } else {
        return `${diffYears} years ago`;
    }
}

/**
 * Determine if a repository was updated within the last 3 days (RECENT_UPDATE_THRESHOLD_DAYS).
 */
function isUpdatedRecently(date) {
    const now = new Date();
    const target = new Date(date);
    const diffMs = now - target;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays < RECENT_UPDATE_THRESHOLD_DAYS;
}

/**
 * Fetch all repositories from the specified GitHub organization using pagination (100 repos per page).
 */
async function getAllRepos(octokit, orgName) {
    try {
        const repos = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const response = await octokit.rest.repos.listForOrg({
                org: orgName,
                type: "public",
                sort: "updated",
                direction: "desc",
                per_page: perPage,
                page: page,
            });

            if (response.data.length === 0) {
                break;
            }

            const processedRepos = response.data.map((repo) => ({
                name: repo.name,
                description: repo.description || "",
                url: repo.html_url,
                homepage: repo.homepage || null,
                topics: repo.topics || [],
                updatedAt: repo.updated_at,
                archived: repo.archived,
            }));

            repos.push(...processedRepos);

            if (response.data.length < perPage) {
                break;
            }

            page++;
        }

        return repos;
    } catch (error) {
        if (error.status === 404) {
            throw new Error(`Organization '${orgName}' not found or not accessible`);
        }
        throw error;
    }
}

/**
 * Sort repositories with recently updated first (alphabetically), then older by date (newest first).
 * @param {Array} repos - List of repositories to sort
 * @param {boolean} sortAscending - If true, sort recent repos A-Z. If false, sort Z-A.
 */
function sortRepositories(repos, sortAscending = true) {
    return repos.sort((a, b) => {
        const aRecent = isUpdatedRecently(a.updatedAt);
        const bRecent = isUpdatedRecently(b.updatedAt);

        // Both have same recency status
        if (aRecent === bRecent) {
            if (aRecent) {
                // Both are recent: sort alphabetically
                return sortAscending
                    ? a.name.localeCompare(b.name) // A-Z
                    : b.name.localeCompare(a.name); // Z-A
            } else {
                // Both are older: sort by update date (latest first)
                return new Date(b.updatedAt) - new Date(a.updatedAt);
            }
        }

        // Different recency: recent items come first
        return aRecent ? -1 : 1;
    });
}

/**
 * Generate markdown table rows with configurable columns (link, tags) for repository display.
 */
function generateTableRows(repos, includeLink = true, includeTags = true) {
    return repos
        .map((repo) => {
            // Format individual cell content
            const updatedDate = isUpdatedRecently(repo.updatedAt) ? "recently" : getRelativeTime(repo.updatedAt);
            const repoLink = `[${repo.name}](${repo.url})`;
            const topicsStr = repo.topics.join(", ");
            const websiteLink = repo.homepage ? `[Link](${repo.homepage})` : "";
            const description = repo.description;

            // Build row based on column configuration
            if (includeLink && includeTags) {
                return `| ${repoLink} | ${description} | ${topicsStr} | ${websiteLink} | ${updatedDate} |`;
            } else if (includeLink && !includeTags) {
                return `| ${repoLink} | ${description} | ${websiteLink} | ${updatedDate} |`;
            } else if (!includeLink && includeTags) {
                return `| ${repoLink} | ${description} | ${topicsStr} | ${updatedDate} |`;
            } else {
                return `| ${repoLink} | ${description} | ${updatedDate} |`;
            }
        })
        .join("\n");
}

/**
 * Build the header section with welcome message and pinned repositories (runtime, studio).
 */
function buildHeaderSection() {
    return `Welcome to the Amoga organization!`;
}

/**
 * Build a markdown table section with heading, header, and rows for a repository category.
 */
function buildTableSection(title, repos, tableHeader, includeLink, includeTags) {
    const tableRows = generateTableRows(repos, includeLink, includeTags);

    return `### ${title} (${repos.length})

${tableHeader}
${tableRows}`;
}

/**
 * Build the footer section with auto-generation notice.
 */
function buildFooterSection() {
    return `---

*This README is automatically generated daily by GitHub Actions*`;
}

/**
 * Build the public repositories section with link column.
 */
function buildRepositoriesSection(repos) {
    const tableHeader = `| Repository | Description | Link | Updated |
|------------|-------------|------|---------|`;

    return buildTableSection("Public Repositories", repos, tableHeader, true, false);
}

/**
 * Assemble all README sections into a complete markdown document with proper spacing.
 */
function assembleReadme(header, reposSection, footer) {
    return `${header}

${reposSection}

${footer}
`;
}

/**
 * Write the README content to the configured file path.
 */
async function writeReadme(content) {
    await fs.writeFile(README_FILE_PATH, content);
}

// Execute the main function to start the README update process
main();
