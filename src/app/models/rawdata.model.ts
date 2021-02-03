
import { Injectable } from '@angular/core';
import { GeneralModel } from './general.model'

@Injectable()
export class RawDataModel extends GeneralModel {

    addRawData(data, success, errorf) {
        // console.log("======Raw Data=======");
        // console.log(data);
        // console.log(Object.keys(data));
        // console.log(Object.values(data));
        // console.log("=============");
        let t = "INSERT INTO raw_data (" + Object.keys(data).join(',') + ") VALUES (?,?)";
        this.execQuery(t, Object.values(data), success, errorf);
    }


}
