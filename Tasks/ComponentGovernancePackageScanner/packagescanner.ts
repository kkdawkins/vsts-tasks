import * as path from "path";
import * as url from "url";
import * as tl from "vsts-task-lib/task";
import vsts = require('vso-node-api');
import * as lim from 'vso-node-api/interfaces/LocationsInterfaces';

import { IExecOptions } from "vsts-task-lib/toolrunner";

import * as cdHelper from "./ConnectionDataHelper";

export class packageScanner {
    private verboseEnabled: boolean;
    private productId: string;
    private filePath: string;

    constructor() {
        this.verboseEnabled = tl.getBoolInput("verbosity", false);
        this.filePath = tl.getPathInput("root", false, false);
    }

    public async execute(){
        tl.setResourcePath(path.join(__dirname, "task.json"));

        try{
            // Discover where dotnet is on the build machine. 
            const dotnetPath = tl.which("dotnet", true);
            
            if (!this.filePath){
                this.filePath = tl.getVariable("System.DefaultWorkingDirectory") || process.cwd();
            }

            // TODO : This is the "correct" way once they enable Org level PATs from Build UX
            // let authToken = tl.getEndpointAuthorizationParameter('SYSTEMVSSCONNECTION', 'ACCESSTOKEN', false);
            let authToken = tl.getVariable("superpat");

            if (authToken === undefined || authToken.length < 1){
                throw "No auth token defined. Please define the superpat";
            }

            let governanceBaseUri = await this.computeGovernanceServiceURI(authToken);

            tl.debug(`Found governance base uri: ${governanceBaseUri}`);

            // 1. Validate product exists
            let targetProduct = tl.getInput("governanceProduct", true);

            if(!this.validateProductExists(governanceBaseUri, authToken, targetProduct)){
                throw tl.loc("Error_ProductNotFound");
            }

            tl.debug("Product successfully found.");

            // 2. Run scanner
            let packageScannerReturn = await this.executePackageScan(dotnetPath, this.filePath, governanceBaseUri + `_apis/Governance/Products/${targetProduct}/RegistrationRequests?api-version=4.0-preview`, authToken);

            if (packageScannerReturn.toString() === "1"){
                tl.setResult(tl.TaskResult.SucceededWithIssues, tl.loc("PartialSuccess_PackageScanner"));
            }
            else if (packageScannerReturn.toString() === "2")
            {
                tl.setResult(tl.TaskResult.Failed, tl.loc("Error_PackageScanner"));
            }
        }
        catch (error){
            tl.error(error);
            tl.setResult(tl.TaskResult.Failed, tl.loc("Error_ToolExecution"));
        }
    }

    private async executePackageScan(dotnetPath: string, sourcePath: string, serviceUri:string, authToken:string): Promise<number>{
        let dotnet = tl.tool(dotnetPath);

        dotnet.arg(this.getPackageScannerLocation());

        if (this.verboseEnabled){
            dotnet.arg("--Verbose");

            dotnet.arg("--Output");
            dotnet.arg(tl.getVariable("BUILD_STAGINGDIRECTORY"));
        }

        dotnet.arg("--ScanDirectory");
        dotnet.arg(sourcePath);

        dotnet.arg("--Url");
        dotnet.arg(serviceUri);

        dotnet.arg("--Pat");
        dotnet.arg(authToken);

        return dotnet.exec();
    }

    private async validateProductExists(governanceBaseUrl: string, accessToken:string, productId: string): Promise<boolean> {
        let registrationRequestAreaId = "03FC139A-0D29-47BC-962A-0BF663090AA1";
        const ApiVersion = "4.0-preview.1";

        // let vssConnection = new vsts.WebApi(governanceOrgBaseUrl, credentialHandler);
        // let coreApi = vssConnection.getCoreApi();

        // let versionData = await coreApi.vsoClient.getVersioningData(ApiVersion, "Governance", registrationRequestAreaId, { productId: "123" })

        let authHandler = accessToken.length == 52 ? vsts.getPersonalAccessTokenHandler(accessToken) : vsts.getBearerHandler(accessToken); 

        let vsoRestClient = new cdHelper.ConnectionDataHelper<string>(governanceBaseUrl, [authHandler]);

        tl.debug("Trying to find product on:");
        tl.debug(governanceBaseUrl + `_apis/Governance/Products/${productId}`);

        let orgConnectionData = await vsoRestClient.http.get(governanceBaseUrl + `_apis/Governance/Products/${productId}`);

        tl.debug("Status code: " + orgConnectionData.message.statusCode);
        return orgConnectionData.message.statusCode.toString() === "200";
    }

    private getPackageScannerLocation(): string {
        const packageScannerBasePath = "GovernancePackageScanner/2.0.0";
        const packageScannerToolName = "GovernancePackageScanner.dll";

        let toolPath = path.join(__dirname, packageScannerBasePath, packageScannerToolName);

        tl.debug(`Checking possible tool path ${toolPath}`);

        if (tl.exist(toolPath)) {
            tl.debug("Tool found");
            return toolPath;
        }

        tl.debug("Tool not found");

        throw tl.loc("Error_PackageScannerNotFound");
    }

    private async computeGovernanceServiceURI(accessToken: string): Promise<string> {
        let collectionUrl = tl.getVariable("System.TeamFoundationCollectionUri");

        // TODO : Make auth handler a global property
        let authHandler = accessToken.length == 52 ? vsts.getPersonalAccessTokenHandler(accessToken) : vsts.getBearerHandler(accessToken);

        tl.debug("Found collection URL");
        tl.debug(collectionUrl);

        let vsoRestClient = new cdHelper.ConnectionDataHelper<lim.ConnectionData>(collectionUrl, [authHandler]);

        let collectionConnectionData = await vsoRestClient.getResolvedConnectionData();

        tl.debug("User ID " + collectionConnectionData.authenticatedUser.id);
        tl.debug("Got collection connection data.");
        
        let orgLocationService = this.findServiceByIdentifier(collectionConnectionData, "8d299418-9467-402b-a171-9165e2f703e2");

        var orgBaseUrl = orgLocationService.locationMappings.find(x => x.accessMappingMoniker === "HostGuidAccessMapping");

        tl.debug("Found org base URL");
        tl.debug(orgBaseUrl.location);

        //let orgConnectionData = await new cdHelper.ConnectionDataHelper(orgBaseUrl.location, [authHandler]).connectForceUrl(orgBaseUrl.location);

        let orgConnectionData = await vsoRestClient.getUnResolvedConnectionData(orgBaseUrl.location);

        let govLocationServiceEntry = this.findServiceByIdentifier(orgConnectionData, "bf89950b-58e4-4c83-8e40-ba3163d111bd");

        tl.debug("Think I found the governance mapping");
        tl.debug(govLocationServiceEntry.displayName);
        tl.debug("That should read Governance");

        for (var mapping of govLocationServiceEntry.locationMappings){
            if (mapping.accessMappingMoniker === "HostGuidAccessMapping"){
                
                tl.debug("Found gov org base URL");
                tl.debug(mapping.location);

                return mapping.location;
            }
        }

        // TODO : Throw error
        return "";
    }

    private findServiceByIdentifier(connectionData: lim.ConnectionData, serviceId: string): lim.ServiceDefinition {
        let serviceIdUppercase = serviceId.toUpperCase();
        let serviceDefinitions = connectionData.locationServiceData.serviceDefinitions;
        return serviceDefinitions.find(service => service.identifier.toUpperCase() === serviceIdUppercase);
    }
}

var exe = new packageScanner();
exe.execute().catch((reason) => tl.setResult(tl.TaskResult.Failed, reason));