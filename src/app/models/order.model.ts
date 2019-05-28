
import { GeneralModel } from './general.model'

export class OrderModel extends GeneralModel {


    addOrderTest(data, success, errorf) {
        // console.log("======ORDER=======");
        // console.log(data);
        // console.log(Object.keys(data));
        // console.log(Object.values(data));
        // console.log("=============");
        let t = "INSERT INTO orders (" + Object.keys(data).join(',') + ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
        this.exec(t, Object.values(data), success, errorf);
    }

    fetchLastOrders(success, errorf){
        let t = "SELECT * FROM orders ORDER BY id DESC LIMIT 100";
        this.exec(t, null, success, errorf);
    }

    addOrderTestLog(data, success, errorf) {
        // console.log("%%%%%%%ORDERLOG%%%%%%%");
        // console.log(data);
        // console.log("%%%%%%%%%%%%%%");      
        let t = "INSERT INTO orders_log (testedBy,units,results,analysedDateTime,specimenDateTime,acceptedDateTime";
        t += ",machineUsed,testLocation,status,orderID,testType,clientID1) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
        this.exec(t, data, success, errorf);
    }

    addResults(data, success, errorf) {
        let t = "UPDATE orders SET tested_by = ?,test_unit = ?,results = ?,analysed_date_time = ?,specimen_date_time = ?";
        t += ",result_accepted_date_time = ?,machine_used = ?,test_location = ?,result_status = ? ";
        t += " WHERE test_id = ? AND result_status < 1";
        this.exec(t, data, success, errorf);
    }


}