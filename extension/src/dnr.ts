type Rule = chrome.declarativeNetRequest.Rule;

export const PIXEL_BLOCK_RULE_ID = 1;

/**
 * Your own Gmail loads the pixel of a message you sent straight from the Worker (not via Gmail's
 * proxy), right after sending and whenever you reopen it. Blocking that request in this browser keeps
 * those views out of the counts. Recipients' opens arrive via Gmail's proxy or other clients, never
 * as an image request from your mail.google.com tab.
 */
export function pixelBlockRule(origin: string): Rule {
  return {
    id: PIXEL_BLOCK_RULE_ID,
    priority: 1,
    action: { type: "block" as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      urlFilter: `|${origin}/p/`,
      initiatorDomains: ["mail.google.com"],
      resourceTypes: ["image" as chrome.declarativeNetRequest.ResourceType],
    },
  };
}
