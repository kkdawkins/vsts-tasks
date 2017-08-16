import vstsClientBases = require("vso-node-api/ClientApiBases");
import VsoBaseInterfaces = require("vso-node-api/interfaces/common/VsoBaseInterfaces");
import * as rm from 'typed-rest-client/RestClient';
import * as lim from 'vso-node-api/interfaces/LocationsInterfaces';

export class ConnectionDataHelper<T> extends vstsClientBases.ClientApiBase {
    constructor(baseUrl: string, handlers: VsoBaseInterfaces.IRequestHandler[]) {
        super(baseUrl, handlers, "vsts-componentgovernance-build-task");
    }

    public async getResolvedConnectionData(): Promise<T> {
        return new Promise<T>(async (resolve, reject) => {
            try {
                let res: rm.IRestResponse<T>;
                res = await this.rest.get<T>(this.vsoClient.resolveUrl('/_apis/connectionData?connectOptions=includeServices'));
                resolve(res.result);
            }
            catch (err) {
                reject(err);
            }
        });
    }

    public async getUnResolvedConnectionData(url: string): Promise<T> {
        return new Promise<T>(async (resolve, reject) => {
            try {
                let res: rm.IRestResponse<T>;
                res = await this.rest.get<T>(url + '_apis/connectionData?connectOptions=includeServices');
                resolve(res.result);
            }
            catch (err) {
                reject(err);
            }
        });
    }
}