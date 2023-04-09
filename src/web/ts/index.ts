const headline = process.env.HEADLINE;
const subHeading = process.env.SUB_HEADING;
const linkedInUrl1 = process.env.LINKEDIN_URL1;
const linkedInUrl2 = process.env.LINKEDIN_URL2;
const githubUrl = process.env.GITHUB_URL;

const headlineSpan = document.getElementById('headline');
const subHeadingSpan = document.getElementById('subHeading');
const linkedInUrl1Element = document.getElementById('linkedInUrl1') as HTMLAnchorElement;
const linkedInUrl2Element = document.getElementById('linkedInUrl2') as HTMLAnchorElement;
const githubUrlElement = document.getElementById('githubUrl') as HTMLAnchorElement;

/**
 * Setup page on load
 */
window.onload = function loadPage() {
    try {
        if (headlineSpan && headline) { headlineSpan.textContent = headline; }
        if (subHeadingSpan && subHeading) { subHeadingSpan.textContent = subHeading; }
        if (linkedInUrl1Element && linkedInUrl1) { linkedInUrl1Element.href = linkedInUrl1; }
        if (linkedInUrl2Element && linkedInUrl2) { linkedInUrl2Element.href = linkedInUrl2; }
        if (githubUrlElement && githubUrl) { githubUrlElement.href = githubUrl; }

        return true;
    } catch (err) {
        return false;
    }
};
