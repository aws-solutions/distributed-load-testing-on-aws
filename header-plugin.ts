// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Rule } from "eslint";

const EXPECTED_HEADER = `// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0`;

const rule: Rule.RuleModule = {
  meta: {
    type: "layout",
    fixable: "code",
    messages: {
      missingHeader: "Missing license header",
      wrongHeader: "Incorrect license header",
    },
  },
  create(context) {
    return {
      Program(node) {
        const sourceCode = context.sourceCode;
        const source = sourceCode.text;

        // Skip if file already has correct header
        if (source.startsWith(EXPECTED_HEADER)) {
          return;
        }

        context.report({
          node,
          messageId: source.startsWith("//") ? "wrongHeader" : "missingHeader",
          fix(fixer) {
            return fixer.insertTextBefore(node, EXPECTED_HEADER + "\n\n");
          },
        });
      },
    };
  },
};

export default {
  meta: { name: "header-plugin" },
  rules: { header: rule },
};
