// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "shualletjs-nextjs-boilerplate",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          profile:
            input.stage === "production"
              ? "hodlocker-production"
              : "hodlocker-dev",
        },
      },
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("fbxfun-bucket", {
      access: "public",
    });
    
    new sst.aws.Nextjs("FBXFUN"),
      {
        domain: "vzn.gold",
        link: [bucket],
        dns: false,
        cert: "arn:aws:acm:us-east-1:861276120584:certificate/fed26456-fc65-4623-a36a-2f2d74f91e11",
      };
  },
});
