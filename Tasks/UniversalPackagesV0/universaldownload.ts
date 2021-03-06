import * as tl from "vsts-task-lib";
import * as pkgLocationUtils from "packaging-common/locationUtilities"; 
import {IExecSyncResult, IExecOptions} from "vsts-task-lib/toolrunner";
import * as telemetry from "utility-common/telemetry";
import * as artifactToolRunner from "./Common/ArtifactToolRunner";
import * as artifactToolUtilities from "./Common/ArtifactToolUtilities";
import * as auth from "./Common/Authentication";

export async function run(artifactToolPath: string): Promise<void> {
    let buildIdentityDisplayName: string = null;
    let buildIdentityAccount: string = null;
    try {
        // Get directory to publish
        let downloadDir: string = tl.getInput("downloadDirectory");
        if (downloadDir.length < 1)
        {
            tl.warning(tl.loc("Info_DownloadDirectoryNotFound"));
            return;
        }

        let serviceUri: string;
        let feedId: string;
        let packageName: string;
        let version: string;

        // Feed Auth
        let feedType = tl.getInput("internalOrExternalDownload") || "internal";

        const normalizedFeedType = ["internal", "external"].find((x) =>
            feedType.toUpperCase() === x.toUpperCase());
        if (!normalizedFeedType) {
            throw new Error(tl.loc("UnknownFeedType", feedType));
        }
        feedType = normalizedFeedType;

        let internalAuthInfo: auth.InternalAuthInfo;

        let toolRunnerOptions = artifactToolRunner.getOptions();

        if (feedType === "internal")
        {
            // getting inputs
            serviceUri = tl.getEndpointUrl("SYSTEMVSSCONNECTION", false);

            feedId = tl.getInput("feedListDownload");

            // Getting package name from package Id
            const packageId = tl.getInput("packageListDownload");
            const accessToken = pkgLocationUtils.getSystemAccessToken();

            internalAuthInfo = new auth.InternalAuthInfo([], accessToken);

            const feedUri = await pkgLocationUtils.getFeedUriFromBaseServiceUri(serviceUri, accessToken);
            packageName = await artifactToolUtilities.getPackageNameFromId(feedUri, accessToken, feedId, packageId);

            version = tl.getInput("versionListDownload");

            toolRunnerOptions.env.UNIVERSAL_DOWNLOAD_PAT = internalAuthInfo.accessToken;
        }
        else {
            let externalAuthInfo = auth.GetExternalAuthInfo("externalEndpoint");

            if (!externalAuthInfo)
            {
                tl.setResult(tl.TaskResult.Failed, tl.loc("Error_NoSourceSpecifiedForDownload"));
                return;
            }

            serviceUri = externalAuthInfo.packageSource.accountUrl;
            feedId = tl.getInput("feedDownloadExternal");
            packageName = tl.getInput("packageDownloadExternal");
            version = tl.getInput("versionDownloadExternal");

            // Assuming only auth via PAT works for now
            const tokenAuth = externalAuthInfo as auth.TokenExternalAuthInfo;
            toolRunnerOptions.env.UNIVERSAL_DOWNLOAD_PAT = tokenAuth.token;
        }

        tl.debug(tl.loc("Info_UsingArtifactToolDownload"));

        const downloadOptions = {
            artifactToolPath,
            feedId,
            accountUrl: serviceUri,
            packageName,
            packageVersion: version,
        } as artifactToolRunner.IArtifactToolOptions;

        downloadPackageUsingArtifactTool(downloadDir, downloadOptions, toolRunnerOptions);

        tl.setResult(tl.TaskResult.Succeeded, tl.loc("PackagesDownloadedSuccessfully"));

    } catch (err) {
        tl.error(err);

        if (buildIdentityDisplayName || buildIdentityAccount) {
            tl.warning(tl.loc("BuildIdentityPermissionsHint", buildIdentityDisplayName, buildIdentityAccount));
        }

        tl.setResult(tl.TaskResult.Failed, tl.loc("PackagesFailedToDownload"));
    }
}

function downloadPackageUsingArtifactTool(downloadDir: string, options: artifactToolRunner.IArtifactToolOptions, execOptions: IExecOptions) {

    let command = new Array<string>();

    command.push("universal", "download",
        "--feed", options.feedId,
        "--service", options.accountUrl,
        "--package-name", options.packageName,
        "--package-version", options.packageVersion,
        "--path", downloadDir,
        "--patvar", "UNIVERSAL_DOWNLOAD_PAT",
        "--verbosity", tl.getInput("verbosity"));

    console.log(tl.loc("Info_Downloading", options.packageName, options.packageVersion, options.feedId));
    const execResult: IExecSyncResult = artifactToolRunner.runArtifactTool(options.artifactToolPath, command, execOptions);
    if (execResult.code === 0) {
        return;
    }

    telemetry.logResult("Packaging", "UniversalPackagesCommand", execResult.code);
    throw new Error(tl.loc("Error_UnexpectedErrorArtifactToolDownload",
        execResult.code,
        execResult.stderr ? execResult.stderr.trim() : execResult.stderr));
}
